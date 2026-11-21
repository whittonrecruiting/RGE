import { assertClerkConfigured } from "@/lib/clerk-config";
import type { Role } from "@/lib/auth";

/** The Clerk organization calls team management needs. Injectable so tests use a fake. */
export interface TeamClerk {
  inviteToOrganization(args: { orgId: string; email: string; role: Role }): Promise<void>;
  removeFromOrganization(args: { orgId: string; clerkUserId: string }): Promise<void>;
  updateMembershipRole(args: { orgId: string; clerkUserId: string; role: Role }): Promise<void>;
}

/** removeFromOrganization throws this when the membership is already gone in Clerk. */
export class ClerkNotFoundError extends Error {}

// Inverse of mapClerkRole in src/lib/auth.ts.
const CLERK_ROLE_KEY: Record<Role, string> = {
  owner: "org:owner",
  admin: "org:admin",
  recruiter: "org:recruiter",
};

async function organizationsApi() {
  assertClerkConfigured();
  const { clerkClient } = await import("@clerk/nextjs/server");
  return (await clerkClient()).organizations;
}

/** The real client, backed by Clerk's Backend API. Keys are checked at call time, not import time. */
const realClerk: TeamClerk = {
  async inviteToOrganization({ orgId, email, role }) {
    const orgs = await organizationsApi();
    await orgs.createOrganizationInvitation({
      organizationId: orgId,
      emailAddress: email,
      role: CLERK_ROLE_KEY[role],
    });
  },
  async removeFromOrganization({ orgId, clerkUserId }) {
    const orgs = await organizationsApi();
    try {
      await orgs.deleteOrganizationMembership({ organizationId: orgId, userId: clerkUserId });
    } catch (err) {
      if ((err as { status?: number }).status === 404) throw new ClerkNotFoundError("Membership not found in Clerk");
      throw err;
    }
  },
  async updateMembershipRole({ orgId, clerkUserId, role }) {
    const orgs = await organizationsApi();
    await orgs.updateOrganizationMembership({
      organizationId: orgId,
      userId: clerkUserId,
      role: CLERK_ROLE_KEY[role],
    });
  },
};

let override: TeamClerk | undefined;

/** Test only: replace the Clerk client (undefined restores the real one). */
export function setTeamClerk(client: TeamClerk | undefined): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setTeamClerk is only available when NODE_ENV is 'test'");
  override = client;
}

export function getTeamClerk(): TeamClerk {
  return override ?? realClerk;
}
