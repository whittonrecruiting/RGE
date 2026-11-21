import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { agencies, memberships, users } from "@/db/schema";
import { withSystem } from "@/db/with-system";
import { mapClerkRole } from "./auth";

/** The subset of Clerk webhook payloads we sync. Clerk sends more fields; we ignore them. */
type ClerkOrg = { id: string; name: string };
type ClerkUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_email_address_id: string | null;
  email_addresses: { id: string; email_address: string }[];
};
type ClerkMembership = {
  role: string;
  organization: ClerkOrg;
  public_user_data: { user_id: string; identifier: string; first_name: string | null; last_name: string | null };
};
export type ClerkEvent = { type: string; data: unknown };

export type WebhookVerifier = (req: Request) => Promise<ClerkEvent>;

/** Thrown when the server cannot verify webhooks at all (missing secret): a 500, not a 401. */
class WebhookConfigError extends Error {}

const clerkVerifier: WebhookVerifier = async (req) => {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) {
    throw new WebhookConfigError(
      "CLERK_WEBHOOK_SIGNING_SECRET is not set: add the webhook signing secret from the Clerk dashboard to .env.local.",
    );
  }
  const { verifyWebhook } = await import("@clerk/nextjs/webhooks");
  // A plain web Request is accepted at runtime (isRequestWebAPI); the type only lists Next request shapes.
  return verifyWebhook(req as Parameters<typeof verifyWebhook>[0]);
};

const displayName = (first: string | null, last: string | null, fallback: string) =>
  [first, last].filter(Boolean).join(" ").trim() || fallback;

// Upserts update only when a value actually differs, so replaying an event changes nothing
// (not even updated_at).
async function upsertAgency(tx: Tx, org: ClerkOrg): Promise<string> {
  const [row] = await tx
    .insert(agencies)
    .values({ clerkOrgId: org.id, name: org.name })
    .onConflictDoUpdate({
      target: agencies.clerkOrgId,
      set: { name: sql`excluded.name`, updatedAt: sql`now()` },
      setWhere: sql`${agencies.name} is distinct from excluded.name`,
    })
    .returning({ id: agencies.id });
  return row?.id ?? (await agencyIdOf(tx, org.id));
}

async function agencyIdOf(tx: Tx, clerkOrgId: string): Promise<string> {
  const [row] = await tx.select({ id: agencies.id }).from(agencies).where(sql`${agencies.clerkOrgId} = ${clerkOrgId}`);
  return row.id;
}

async function userIdOf(tx: Tx, clerkUserId: string): Promise<string> {
  const [row] = await tx.select({ id: users.id }).from(users).where(sql`${users.clerkUserId} = ${clerkUserId}`);
  return row.id;
}

async function upsertUser(tx: Tx, u: { clerkUserId: string; email: string; name: string }): Promise<void> {
  await tx
    .insert(users)
    .values(u)
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: { email: sql`excluded.email`, name: sql`excluded.name`, updatedAt: sql`now()` },
      setWhere: sql`(${users.email}, ${users.name}) is distinct from (excluded.email, excluded.name)`,
    });
}

function userFromClerk(data: ClerkUser) {
  const primary =
    data.email_addresses.find((e) => e.id === data.primary_email_address_id) ?? data.email_addresses[0];
  const email = primary?.email_address ?? "";
  return { clerkUserId: data.id, email, name: displayName(data.first_name, data.last_name, email) };
}

async function syncMembership(tx: Tx, data: ClerkMembership): Promise<void> {
  // organization.* and user.* events own the agency name and user profile. The copies embedded
  // in a membership event only create missing rows, so an old replay cannot overwrite newer data.
  await tx
    .insert(agencies)
    .values({ clerkOrgId: data.organization.id, name: data.organization.name })
    .onConflictDoNothing({ target: agencies.clerkOrgId });
  const p = data.public_user_data;
  await tx
    .insert(users)
    .values({ clerkUserId: p.user_id, email: p.identifier, name: displayName(p.first_name, p.last_name, p.identifier) })
    .onConflictDoNothing({ target: users.clerkUserId });
  const agencyId = await agencyIdOf(tx, data.organization.id);
  const userId = await userIdOf(tx, p.user_id);
  await tx
    .insert(memberships)
    .values({ agencyId, userId, role: mapClerkRole(data.role), status: "active" })
    .onConflictDoUpdate({
      target: [memberships.agencyId, memberships.userId],
      // A created/updated event for a removed member means they were re-invited: reactivate.
      set: { role: sql`excluded.role`, status: sql`excluded.status`, updatedAt: sql`now()` },
      setWhere: sql`(${memberships.role}, ${memberships.status}) is distinct from (excluded.role, excluded.status)`,
    });
}

/** Applies one verified Clerk event to agencies, users and memberships. Idempotent. */
export async function applyClerkEvent(event: ClerkEvent): Promise<void> {
  switch (event.type) {
    case "organization.created":
    case "organization.updated":
      await withSystem((tx) => upsertAgency(tx, event.data as ClerkOrg));
      return;
    case "organization.deleted":
      // Deleting an agency's data is a later, deliberate feature; nothing is removed here.
      console.info(`Clerk organization.deleted for ${(event.data as { id?: string }).id}: ignored, agency data kept.`);
      return;
    case "user.created":
    case "user.updated":
      await withSystem((tx) => upsertUser(tx, userFromClerk(event.data as ClerkUser)));
      return;
    case "organizationMembership.created":
    case "organizationMembership.updated":
      await withSystem((tx) => syncMembership(tx, event.data as ClerkMembership));
      return;
    case "organizationMembership.deleted": {
      // Removal is soft and is performed by our own removeMember action (which sets status
      // 'removed' itself), so the row is kept here.
      const m = event.data as ClerkMembership;
      console.info(
        `Clerk organizationMembership.deleted for ${m.public_user_data?.user_id} in ${m.organization?.id}: membership kept.`,
      );
      return;
    }
    default:
      return;
  }
}

/** Builds the POST handler. The verifier is injectable so tests need no Clerk account. */
export function createClerkWebhookHandler({ verify = clerkVerifier }: { verify?: WebhookVerifier } = {}) {
  return async function POST(req: Request): Promise<Response> {
    let event: ClerkEvent;
    try {
      event = await verify(req);
    } catch (err) {
      if (err instanceof WebhookConfigError) {
        console.error(err.message);
        return new Response(err.message, { status: 500 });
      }
      return new Response("Invalid webhook signature", { status: 401 });
    }
    await applyClerkEvent(event);
    return new Response("ok", { status: 200 });
  };
}
