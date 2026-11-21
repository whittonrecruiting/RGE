import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Tx } from "@/db/client";
import { agencies, memberships, users } from "@/db/schema";
import { withSystem } from "@/db/with-system";
import { mapClerkRole } from "./auth";

/** The subset of Clerk webhook payloads we sync. Clerk sends more fields; we ignore them. */
type ClerkOrg = { id: string; name: string; updated_at?: number };
type ClerkUser = {
  id: string;
  updated_at?: number;
  first_name: string | null;
  last_name: string | null;
  primary_email_address_id: string | null;
  email_addresses: { id: string; email_address: string }[];
};
type ClerkMembership = {
  role: string;
  updated_at?: number;
  organization: ClerkOrg;
  public_user_data: { user_id: string; identifier: string; first_name: string | null; last_name: string | null };
};
/** timestamp: when Clerk emitted the event (ms since epoch). */
export type ClerkEvent = { type: string; data: unknown; timestamp?: number };

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

/**
 * Clerk can deliver webhooks out of order. Each synced row keeps the Clerk updated_at of the last
 * event applied (clerk_updated_at), and an event changes a row only when it is strictly newer. A
 * row with no stored time (created from another event's embedded copy) takes the first event.
 * An event without a time cannot be ordered, so it only fills a row that has none.
 */
const clerkTime = (ms: unknown): Date | null => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms) : null);

const isNewer = (stored: AnyPgColumn) =>
  sql`(${stored} is null or (excluded.clerk_updated_at is not null and ${stored} < excluded.clerk_updated_at))`;

// Replaying an event changes nothing (not even updated_at): its time is not newer than the stored one.
async function upsertAgency(tx: Tx, org: ClerkOrg): Promise<string> {
  const [row] = await tx
    .insert(agencies)
    .values({ clerkOrgId: org.id, name: org.name, clerkUpdatedAt: clerkTime(org.updated_at) })
    .onConflictDoUpdate({
      target: agencies.clerkOrgId,
      set: { name: sql`excluded.name`, clerkUpdatedAt: sql`excluded.clerk_updated_at`, updatedAt: sql`now()` },
      setWhere: isNewer(agencies.clerkUpdatedAt),
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

async function upsertUser(
  tx: Tx,
  u: { clerkUserId: string; email: string; name: string; clerkUpdatedAt: Date | null },
): Promise<void> {
  await tx
    .insert(users)
    .values(u)
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: {
        email: sql`excluded.email`,
        name: sql`excluded.name`,
        clerkUpdatedAt: sql`excluded.clerk_updated_at`,
        updatedAt: sql`now()`,
      },
      setWhere: isNewer(users.clerkUpdatedAt),
    });
}

function userFromClerk(data: ClerkUser) {
  const primary =
    data.email_addresses.find((e) => e.id === data.primary_email_address_id) ?? data.email_addresses[0];
  const email = primary?.email_address ?? "";
  return {
    clerkUserId: data.id,
    email,
    name: displayName(data.first_name, data.last_name, email),
    clerkUpdatedAt: clerkTime(data.updated_at),
  };
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
    .values({ agencyId, userId, role: mapClerkRole(data.role), status: "active", clerkUpdatedAt: clerkTime(data.updated_at) })
    .onConflictDoUpdate({
      target: [memberships.agencyId, memberships.userId],
      // A newer created/updated event for a removed member means they were re-invited: reactivate.
      // An older one (delivered after the deletion) is skipped, so it cannot restore the member.
      set: {
        role: sql`excluded.role`,
        status: sql`excluded.status`,
        clerkUpdatedAt: sql`excluded.clerk_updated_at`,
        updatedAt: sql`now()`,
      },
      setWhere: isNewer(memberships.clerkUpdatedAt),
    });
}

/**
 * Deletion always soft-removes. It also records its time (the event timestamp, else the payload's
 * updated_at, else now) when that is newer, so a stale update delivered later cannot reactivate.
 */
async function removeMembership(tx: Tx, data: ClerkMembership, eventTime: number | undefined): Promise<void> {
  const clerkOrgId = data.organization?.id;
  const clerkUserId = data.public_user_data?.user_id;
  if (!clerkOrgId || !clerkUserId) return;
  const [agency] = await tx.select({ id: agencies.id }).from(agencies).where(sql`${agencies.clerkOrgId} = ${clerkOrgId}`);
  const [user] = await tx.select({ id: users.id }).from(users).where(sql`${users.clerkUserId} = ${clerkUserId}`);
  if (!agency || !user) return;
  const at = clerkTime(eventTime) ?? clerkTime(data.updated_at) ?? new Date();
  await tx
    .update(memberships)
    .set({ status: "removed", clerkUpdatedAt: sql`greatest(${memberships.clerkUpdatedAt}, ${at})`, updatedAt: sql`now()` })
    .where(
      sql`${memberships.agencyId} = ${agency.id} and ${memberships.userId} = ${user.id}
        and (${memberships.status} <> 'removed' or ${memberships.clerkUpdatedAt} is null or ${memberships.clerkUpdatedAt} < ${at})`,
    );
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
    case "organizationMembership.deleted":
      // Soft removal, same as the removeMember action. MPC reassignment stays in that action:
      // rge_system has no access to mpcs. Replays are harmless (the status is already removed).
      await withSystem((tx) => removeMembership(tx, event.data as ClerkMembership, event.timestamp));
      return;
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
