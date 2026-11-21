import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { agencies, memberships, users } from "@/db/schema";
import { withSystem } from "@/db/with-system";
import { assertClerkConfigured } from "./clerk-config";

export type Role = "owner" | "admin" | "recruiter";
export type Member = { userId: string; agencyId: string; role: Role };

/** The part of Clerk's auth() we use: the signed-in Clerk user and their active organization. */
export type AuthState = { userId: string | null; orgId: string | null };
export type AuthReader = () => Promise<AuthState>;

const CLERK_ROLES: Record<string, Role> = {
  "org:owner": "owner",
  "org:admin": "admin",
  "org:recruiter": "recruiter",
};

/** Maps a Clerk organization role key to our role. Unknown roles get the least privilege. */
export function mapClerkRole(clerkRole: string): Role {
  const role = CLERK_ROLES[clerkRole];
  if (role) return role;
  console.warn(`Unknown Clerk organization role "${clerkRole}"; treating it as recruiter.`);
  return "recruiter";
}

const clerkAuthReader: AuthReader = async () => {
  assertClerkConfigured();
  const { auth } = await import("@clerk/nextjs/server");
  const { userId, orgId } = await auth();
  return { userId: userId ?? null, orgId: orgId ?? null };
};

const testOnly = (name: string) => {
  if (process.env.NODE_ENV !== "test") throw new Error(`${name} is only available when NODE_ENV is 'test'`);
};

let authReaderOverride: AuthReader | undefined;

/** Test only: replace Clerk's auth() reader (undefined restores it). */
export function setAuthReader(reader: AuthReader | undefined): void {
  testOnly("setAuthReader");
  authReaderOverride = reader;
}

const memberStub = new AsyncLocalStorage<Member>();

/** Test only: requireMember() returns member while fn runs (see tests/helpers/as-member.ts). */
export function runAsMember<T>(member: Member, fn: () => Promise<T>): Promise<T> {
  testOnly("runAsMember");
  return memberStub.run(member, fn);
}

/**
 * The signed-in member of the active agency. Redirects to /sign-in when signed out and to
 * /no-agency when there is no active organization or it does not map to a synced membership.
 *
 * The lookup runs as rge_system because no agency context exists yet; it only reads
 * agencies, users and memberships. Callers then use withAgency(member.agencyId, ...).
 */
export async function requireMember(): Promise<Member> {
  if (process.env.NODE_ENV === "test") {
    const stubbed = memberStub.getStore();
    if (stubbed) return stubbed;
  }
  const { userId, orgId } = await (authReaderOverride ?? clerkAuthReader)();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/no-agency");

  const [row] = await withSystem((tx) =>
    tx
      .select({ userId: users.id, agencyId: agencies.id, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(agencies, eq(agencies.id, memberships.agencyId))
      .where(and(eq(users.clerkUserId, userId), eq(agencies.clerkOrgId, orgId)))
      .limit(1),
  );
  // Not a member, or the Clerk webhook has not synced the membership yet.
  if (!row) redirect("/no-agency");
  return row;
}
