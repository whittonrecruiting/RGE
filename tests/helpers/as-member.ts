import type { Member } from "@/lib/auth";
import { runAsMember } from "@/lib/auth";
import { seedAgencies, type SeededAgency, type TestDb } from "./test-db";

export { seedAgencies, type SeededAgency };

/**
 * Runs fn with requireMember() stubbed to return member. The stub is scoped to fn's async
 * context (AsyncLocalStorage), so it ends when fn settles and never leaks between tests.
 * Later tasks write `xAs(member, ...args)` as shorthand for `asMember(member, () => x(...args))`.
 */
export function asMember<T>(member: Member, fn: () => Promise<T>): Promise<T> {
  return runAsMember(member, fn);
}

export type MemberFixtures = {
  agency: SeededAgency;
  owner: Member;
  admin: Member;
  /** Two recruiters in the same agency. */
  recA: Member;
  recB: Member;
};

/** Member fixtures for one seeded agency. */
export function membersOf(agency: SeededAgency): MemberFixtures {
  const m = (userId: string, role: Member["role"]): Member => ({ userId, agencyId: agency.id, role });
  return {
    agency,
    owner: m(agency.ownerId, "owner"),
    admin: m(agency.adminId, "admin"),
    recA: m(agency.recruiterId, "recruiter"),
    recB: m(agency.recruiter2Id, "recruiter"),
  };
}

/** Seeds one agency and returns its owner, admin, recA and recB fixtures. */
export async function seedMembers(db: TestDb): Promise<MemberFixtures> {
  const [agency] = await seedAgencies(db, 1);
  return membersOf(agency);
}
