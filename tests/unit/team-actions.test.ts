import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { agencies, memberships, mpcs, users } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { inviteMember, removeMember, setMemberRole } from "@/lib/team/actions";
import { revalidatePath } from "next/cache";
import { ClerkNotFoundError, setTeamClerk, type TeamClerk } from "@/lib/team/clerk-client";
import { requireMember, setAuthReader, type Member } from "@/lib/auth";
import { asOwner, createTestDb, type TestDb } from "../helpers/test-db";
import { asMember, seedMembers, type MemberFixtures } from "../helpers/as-member";

// Wraps withAgency so a test can make the next local transaction fail (after Clerk succeeded).
const gate = vi.hoisted(() => ({ failNext: false }));
vi.mock("@/db/with-agency", async (orig) => {
  const actual = await orig<typeof import("@/db/with-agency")>();
  return {
    ...actual,
    withAgency: (...args: Parameters<typeof actual.withAgency>) => {
      if (gate.failNext) {
        gate.failNext = false;
        return Promise.reject(new Error("simulated database failure"));
      }
      return actual.withAgency(...args);
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: TestDb;
let close: (() => Promise<void>) | undefined;
let f: MemberFixtures;
let clerk: { [K in keyof TeamClerk]: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  close = t.close;
  f = await seedMembers(db);
  clerk = {
    inviteToOrganization: vi.fn(async () => {}),
    removeFromOrganization: vi.fn(async () => {}),
    updateMembershipRole: vi.fn(async () => {}),
  };
  setTeamClerk(clerk as unknown as TeamClerk);
  gate.failNext = false;
  vi.mocked(revalidatePath).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  setTeamClerk(undefined);
  setAuthReader(undefined);
  await close?.();
  close = undefined;
});

const inviteMemberAs = (m: Member, email: string, role: Parameters<typeof inviteMember>[1]) =>
  asMember(m, () => inviteMember(email, role));
const setMemberRoleAs = (m: Member, id: string, role: Parameters<typeof setMemberRole>[1]) =>
  asMember(m, () => setMemberRole(id, role));
const removeMemberAs = (m: Member, id: string) => asMember(m, () => removeMember(id));

async function rowOf(userId: string, fx: MemberFixtures = f) {
  const [row] = await asOwner(db, (tx) =>
    tx.select().from(memberships).where(and(eq(memberships.agencyId, fx.agency.id), eq(memberships.userId, userId))),
  );
  return row;
}
const membershipId = async (userId: string, fx: MemberFixtures = f) => (await rowOf(userId, fx)).id;

const NO_PERMISSION = { ok: false, error: "You do not have permission to manage the team." };
const OWNER_ONLY = { ok: false, error: "Only the Owner can change the Owner." };

describe("inviteMember", () => {
  test("recruiter cannot invite", async () => {
    expect(await inviteMemberAs(f.recA, "new@example.test", "recruiter")).toEqual(NO_PERMISSION);
    expect(clerk.inviteToOrganization).not.toHaveBeenCalled();
  });

  test("owner role cannot be granted by invite", async () => {
    expect((await inviteMemberAs(f.owner, "x@example.test", "owner")).ok).toBe(false);
    expect((await inviteMemberAs(f.admin, "x@example.test", "owner")).ok).toBe(false);
    expect(clerk.inviteToOrganization).not.toHaveBeenCalled();
  });

  test("an unknown role string is refused", async () => {
    const r = await inviteMemberAs(f.owner, "x@example.test", "superuser" as never);
    expect(r.ok).toBe(false);
    expect(clerk.inviteToOrganization).not.toHaveBeenCalled();
  });

  test("an invalid email is refused", async () => {
    expect((await inviteMemberAs(f.owner, "not-an-email", "recruiter")).ok).toBe(false);
    expect(clerk.inviteToOrganization).not.toHaveBeenCalled();
  });

  test("owner and admin can invite an admin or recruiter through Clerk for their own org", async () => {
    expect(await inviteMemberAs(f.owner, "  New@Example.test ", "admin")).toEqual({ ok: true });
    expect(await inviteMemberAs(f.admin, "rec@example.test", "recruiter")).toEqual({ ok: true });
    expect(clerk.inviteToOrganization).toHaveBeenNthCalledWith(1, {
      orgId: expect.stringMatching(/^org_test_/),
      email: "new@example.test",
      role: "admin",
    });
    expect(clerk.inviteToOrganization).toHaveBeenNthCalledWith(2, expect.objectContaining({ role: "recruiter" }));
  });

  test("a Clerk failure becomes an inline error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    clerk.inviteToOrganization.mockRejectedValueOnce(new Error("boom"));
    const r = await inviteMemberAs(f.owner, "new@example.test", "recruiter");
    expect(r.ok).toBe(false);
  });
});

describe("setMemberRole", () => {
  test("recruiter cannot change roles", async () => {
    expect(await setMemberRoleAs(f.recA, await membershipId(f.recB.userId), "admin")).toEqual(NO_PERMISSION);
    expect(clerk.updateMembershipRole).not.toHaveBeenCalled();
  });

  test("admin cannot change the Owner; nobody can set owner", async () => {
    const ownerRow = await membershipId(f.owner.userId);
    expect(await setMemberRoleAs(f.admin, ownerRow, "recruiter")).toEqual(OWNER_ONLY);
    expect(await setMemberRoleAs(f.owner, ownerRow, "admin")).toEqual(OWNER_ONLY);
    const recRow = await membershipId(f.recA.userId);
    expect((await setMemberRoleAs(f.owner, recRow, "owner")).ok).toBe(false);
    expect((await setMemberRoleAs(f.admin, recRow, "owner")).ok).toBe(false);
    expect(clerk.updateMembershipRole).not.toHaveBeenCalled();
    expect((await rowOf(f.owner.userId)).role).toBe("owner");
    expect((await rowOf(f.recA.userId)).role).toBe("recruiter");
  });

  test("owner and admin can set admin or recruiter for non-owners (Clerk first, then our table)", async () => {
    expect(await setMemberRoleAs(f.owner, await membershipId(f.recA.userId), "admin")).toEqual({ ok: true });
    expect((await rowOf(f.recA.userId)).role).toBe("admin");
    expect(clerk.updateMembershipRole).toHaveBeenCalledWith({
      orgId: expect.stringMatching(/^org_test_/),
      clerkUserId: expect.stringMatching(/^user_test_/),
      role: "admin",
    });
    expect(await setMemberRoleAs(f.admin, await membershipId(f.recA.userId), "recruiter")).toEqual({ ok: true });
    expect((await rowOf(f.recA.userId)).role).toBe("recruiter");
  });

  test("a Clerk failure leaves our role unchanged", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    clerk.updateMembershipRole.mockRejectedValueOnce(new Error("boom"));
    const r = await setMemberRoleAs(f.owner, await membershipId(f.recA.userId), "admin");
    expect(r.ok).toBe(false);
    expect((await rowOf(f.recA.userId)).role).toBe("recruiter");
  });

  test("a membership of another agency is not found", async () => {
    const other = await seedMembers(db);
    const r = await setMemberRoleAs(f.owner, await membershipId(other.recA.userId, other), "admin");
    expect(r).toEqual({ ok: false, error: "Member not found." });
    expect(clerk.updateMembershipRole).not.toHaveBeenCalled();
  });
});

describe("revalidation", () => {
  test("every successful mutation revalidates /team; failures do not", async () => {
    await inviteMemberAs(f.owner, "new@example.test", "recruiter");
    await setMemberRoleAs(f.owner, await membershipId(f.recA.userId), "admin");
    await removeMemberAs(f.owner, await membershipId(f.recB.userId));
    expect(revalidatePath).toHaveBeenCalledTimes(3);
    expect(revalidatePath).toHaveBeenCalledWith("/team");
    vi.mocked(revalidatePath).mockClear();
    await inviteMemberAs(f.recA, "x@example.test", "recruiter");
    await setMemberRoleAs(f.admin, await membershipId(f.owner.userId), "admin");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("local failure after Clerk succeeded", () => {
  test("setMemberRole returns an inline error instead of throwing", async () => {
    clerk.updateMembershipRole.mockImplementationOnce(async () => {
      gate.failNext = true;
    });
    const r = await setMemberRoleAs(f.owner, await membershipId(f.recA.userId), "admin");
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ error: expect.stringContaining("Try again") });
    expect((await rowOf(f.recA.userId)).role).toBe("recruiter");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("removeMember returns an inline error, and a retry (Clerk not found) completes the removal", async () => {
    await asOwner(db, (tx) =>
      tx
        .insert(mpcs)
        .values({ agencyId: f.agency.id, ownerUserId: f.recA.userId, headlineRole: "Role A", location: "Phoenix" }),
    );
    const id = await membershipId(f.recA.userId);
    clerk.removeFromOrganization.mockImplementationOnce(async () => {
      gate.failNext = true;
    });
    const first = await removeMemberAs(f.owner, id);
    expect(first).toEqual({
      ok: false,
      error: "The member was removed from sign-in but RGE could not finish. Try again.",
    });
    expect((await rowOf(f.recA.userId)).status).toBe("active");
    const [still] = await withAgency(f.agency.id, (tx) => tx.select().from(mpcs));
    expect(still.ownerUserId).toBe(f.recA.userId);
    expect(revalidatePath).not.toHaveBeenCalled();

    clerk.removeFromOrganization.mockRejectedValueOnce(new ClerkNotFoundError("gone"));
    expect(await removeMemberAs(f.owner, id)).toEqual({ ok: true });
    expect((await rowOf(f.recA.userId)).status).toBe("removed");
    const [moved] = await withAgency(f.agency.id, (tx) => tx.select().from(mpcs));
    expect(moved.ownerUserId).toBe(f.owner.userId);
    expect(revalidatePath).toHaveBeenCalledWith("/team");
  });

  test("a Clerk error other than not-found still fails without touching local state", async () => {
    clerk.removeFromOrganization.mockRejectedValueOnce(new Error("boom"));
    const r = await removeMemberAs(f.owner, await membershipId(f.recA.userId));
    expect(r.ok).toBe(false);
    expect((await rowOf(f.recA.userId)).status).toBe("active");
  });
});

describe("removeMember", () => {
  test("with no active Owner it errors, changes nothing and does not call Clerk", async () => {
    await asOwner(db, (tx) =>
      tx.update(memberships).set({ status: "removed" }).where(eq(memberships.userId, f.owner.userId)),
    );
    const r = await removeMemberAs(f.admin, await membershipId(f.recA.userId));
    expect(r.ok).toBe(false);
    expect(clerk.removeFromOrganization).not.toHaveBeenCalled();
    expect((await rowOf(f.recA.userId)).status).toBe("active");
  });

  test("admin cannot remove owner", async () => {
    const r = await removeMemberAs(f.admin, await membershipId(f.owner.userId));
    expect(r).toEqual(OWNER_ONLY);
    expect(clerk.removeFromOrganization).not.toHaveBeenCalled();
  });

  test("recruiter cannot remove anyone", async () => {
    expect(await removeMemberAs(f.recA, await membershipId(f.recB.userId))).toEqual(NO_PERMISSION);
  });

  test("a member cannot remove themselves", async () => {
    const r = await removeMemberAs(f.admin, await membershipId(f.admin.userId));
    expect(r).toEqual({ ok: false, error: "You cannot remove yourself." });
    const o = await removeMemberAs(f.owner, await membershipId(f.owner.userId));
    expect(o).toEqual({ ok: false, error: "You cannot remove yourself." });
    expect(clerk.removeFromOrganization).not.toHaveBeenCalled();
  });

  test("removal is soft, reassigns the member's MPCs to the Owner, and calls Clerk first", async () => {
    await asOwner(db, async (tx) => {
      await tx.insert(mpcs).values([
        { agencyId: f.agency.id, ownerUserId: f.recA.userId, headlineRole: "Role A", location: "Phoenix" },
        { agencyId: f.agency.id, ownerUserId: f.recB.userId, headlineRole: "Role B", location: "Phoenix" },
      ]);
    });
    const r = await removeMemberAs(f.admin, await membershipId(f.recA.userId));
    expect(r).toEqual({ ok: true });
    expect(clerk.removeFromOrganization).toHaveBeenCalledWith({
      orgId: expect.stringMatching(/^org_test_/),
      clerkUserId: expect.stringMatching(/^user_test_/),
    });
    expect((await rowOf(f.recA.userId)).status).toBe("removed");
    const rows = await withAgency(f.agency.id, (tx) => tx.select().from(mpcs));
    const byRole = Object.fromEntries(rows.map((m) => [m.headlineRole, m.ownerUserId]));
    expect(byRole).toEqual({ "Role A": f.owner.userId, "Role B": f.recB.userId });
  });

  test("a Clerk failure changes nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await asOwner(db, (tx) =>
      tx
        .insert(mpcs)
        .values({ agencyId: f.agency.id, ownerUserId: f.recA.userId, headlineRole: "Role A", location: "Phoenix" }),
    );
    clerk.removeFromOrganization.mockRejectedValueOnce(new Error("boom"));
    const r = await removeMemberAs(f.owner, await membershipId(f.recA.userId));
    expect(r.ok).toBe(false);
    expect((await rowOf(f.recA.userId)).status).toBe("active");
    const [m] = await withAgency(f.agency.id, (tx) => tx.select().from(mpcs));
    expect(m.ownerUserId).toBe(f.recA.userId);
  });

  test("an already removed member is not found", async () => {
    const id = await membershipId(f.recA.userId);
    expect(await removeMemberAs(f.owner, id)).toEqual({ ok: true });
    expect(await removeMemberAs(f.owner, id)).toEqual({ ok: false, error: "Member not found." });
  });

  test("the app role cannot delete membership rows (soft removal only)", async () => {
    await expect(withAgency(f.agency.id, (tx) => tx.delete(memberships))).rejects.toSatisfy((e: unknown) =>
      JSON.stringify([(e as Error).message, (e as { cause?: { message?: string } }).cause?.message]).includes(
        "permission denied",
      ),
    );
  });
});

describe("requireMember with a removed membership", () => {
  test("is treated as no membership (redirect to /no-agency)", async () => {
    const { clerkUserId, clerkOrgId } = await asOwner(db, async (tx) => ({
      clerkUserId: (await tx.select().from(users).where(eq(users.id, f.recA.userId)))[0].clerkUserId,
      clerkOrgId: (await tx.select().from(agencies).where(eq(agencies.id, f.agency.id)))[0].clerkOrgId,
    }));
    setAuthReader(async () => ({ userId: clerkUserId, orgId: clerkOrgId }));
    expect(await requireMember()).toMatchObject({ userId: f.recA.userId, agencyId: f.agency.id });
    expect(await removeMemberAs(f.owner, await membershipId(f.recA.userId))).toEqual({ ok: true });
    const err = await requireMember().catch((e) => e);
    expect((err as { digest?: string }).digest).toMatch(/NEXT_REDIRECT;replace;\/no-agency/);
  });
});
