"use server";

import { and, eq } from "drizzle-orm";
import { agencies, memberships, mpcs, users } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { requireMember, type Member, type Role } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getTeamClerk } from "./clerk-client";

export type TeamResult = { ok: true } | { ok: false; error: string };

const NO_PERMISSION = "You do not have permission to manage the team.";
const OWNER_ONLY = "Only the Owner can change the Owner.";
const NOT_FOUND = "Member not found.";
const CLERK_FAILED = "Clerk could not complete that. Nothing was changed. Try again.";

const fail = (error: string): TeamResult => ({ ok: false, error });

/** Roles an action may assign. There is exactly one Owner, so owner is never assignable here. */
const isAssignable = (role: unknown): role is Exclude<Role, "owner"> => role === "admin" || role === "recruiter";

// Every action calls requireMember() itself: the layout guard does not protect server actions.
async function managerOrError(): Promise<{ member: Member } | { error: string }> {
  const member = await requireMember();
  return can(member, "team.manage") ? { member } : { error: NO_PERMISSION };
}

async function agencyClerkOrgId(member: Member): Promise<string> {
  const [row] = await withAgency(member.agencyId, (tx) =>
    tx.select({ clerkOrgId: agencies.clerkOrgId }).from(agencies).where(eq(agencies.id, member.agencyId)),
  );
  return row.clerkOrgId;
}

/** An active membership of the caller's agency (row-level security hides other agencies). */
async function findTarget(member: Member, membershipId: string) {
  const [row] = await withAgency(member.agencyId, (tx) =>
    tx
      .select({
        id: memberships.id,
        userId: memberships.userId,
        role: memberships.role,
        clerkUserId: users.clerkUserId,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.id, membershipId), eq(memberships.status, "active"))),
  );
  return row;
}

export async function inviteMember(email: string, role: Role): Promise<TeamResult> {
  const gate = await managerOrError();
  if ("error" in gate) return fail(gate.error);
  const { member } = gate;
  if (role === "owner") return fail("The Owner role cannot be granted by invitation.");
  if (!isAssignable(role)) return fail("Choose Admin or Recruiter.");
  const address = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return fail("Enter a valid email address.");
  try {
    await getTeamClerk().inviteToOrganization({ orgId: await agencyClerkOrgId(member), email: address, role });
  } catch (err) {
    console.error("inviteMember: Clerk call failed", err);
    return fail(CLERK_FAILED);
  }
  return { ok: true };
}

export async function setMemberRole(membershipId: string, role: Role): Promise<TeamResult> {
  const gate = await managerOrError();
  if ("error" in gate) return fail(gate.error);
  const { member } = gate;
  const target = await findTarget(member, membershipId);
  if (!target) return fail(NOT_FOUND);
  if (target.role === "owner") return fail(OWNER_ONLY);
  if (!isAssignable(role)) return fail("Choose Admin or Recruiter.");
  if (!can(member, "team.setRole", { targetRole: target.role })) return fail(NO_PERMISSION);
  try {
    await getTeamClerk().updateMembershipRole({
      orgId: await agencyClerkOrgId(member),
      clerkUserId: target.clerkUserId,
      role,
    });
  } catch (err) {
    console.error("setMemberRole: Clerk call failed", err);
    return fail(CLERK_FAILED);
  }
  // Mirror Clerk now so the page is immediately right; the webhook would sync the same value.
  await withAgency(member.agencyId, (tx) =>
    tx.update(memberships).set({ role, updatedAt: new Date() }).where(eq(memberships.id, target.id)),
  );
  return { ok: true };
}

export async function removeMember(membershipId: string): Promise<TeamResult> {
  const gate = await managerOrError();
  if ("error" in gate) return fail(gate.error);
  const { member } = gate;
  const target = await findTarget(member, membershipId);
  if (!target) return fail(NOT_FOUND);
  if (target.userId === member.userId) return fail("You cannot remove yourself.");
  if (target.role === "owner") return fail(OWNER_ONLY);
  if (!can(member, "team.remove", { targetRole: target.role })) return fail(NO_PERMISSION);

  const [owner] = await withAgency(member.agencyId, (tx) =>
    tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.role, "owner"), eq(memberships.status, "active"))),
  );
  if (!owner) return fail("This agency has no Owner to take over the member's MPCs. Nothing was changed.");

  // Clerk first: if it fails nothing local changes, so the two sides never disagree.
  try {
    await getTeamClerk().removeFromOrganization({
      orgId: await agencyClerkOrgId(member),
      clerkUserId: target.clerkUserId,
    });
  } catch (err) {
    console.error("removeMember: Clerk call failed", err);
    return fail(CLERK_FAILED);
  }
  await withAgency(member.agencyId, async (tx) => {
    await tx
      .update(memberships)
      .set({ status: "removed", updatedAt: new Date() })
      .where(eq(memberships.id, target.id));
    await tx
      .update(mpcs)
      .set({ ownerUserId: owner.userId, updatedAt: new Date() })
      .where(and(eq(mpcs.agencyId, member.agencyId), eq(mpcs.ownerUserId, target.userId)));
  });
  return { ok: true };
}
