import { afterEach, describe, expect, test, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { agencies, memberships, users } from "@/db/schema";
import { mapClerkRole, requireMember, setAuthReader } from "@/lib/auth";
import { asOwner, createTestDb, seedAgencies } from "../helpers/test-db";
import { asMember, seedMembers } from "../helpers/as-member";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  setAuthReader(undefined);
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

async function setup(n = 2) {
  const t = await createTestDb();
  close = t.close;
  const seeded = await seedAgencies(t.db, n);
  return { db: t.db, agencies: seeded };
}

async function clerkIds(db: Awaited<ReturnType<typeof setup>>["db"], agencyIds: string[], userIds: string[]) {
  return asOwner(db, async (tx) => ({
    orgs: Object.fromEntries(
      (await tx.select().from(agencies).where(inArray(agencies.id, agencyIds))).map((a) => [a.id, a.clerkOrgId]),
    ),
    users: Object.fromEntries(
      (await tx.select().from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.clerkUserId]),
    ),
  }));
}

function redirectTarget(err: unknown): string | undefined {
  const digest = (err as { digest?: string } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT") ? digest.split(";")[2] : undefined;
}

async function redirectOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    return redirectTarget(err);
  }
  throw new Error("expected a redirect");
}

describe("requireMember", () => {
  test("a user in agencies A and B with active org B gets Member.agencyId === B", async () => {
    const { db, agencies: [a, b] } = await setup();
    // Agency A's recruiter is also an admin in agency B.
    await asOwner(db, (tx) => tx.insert(memberships).values({ agencyId: b.id, userId: a.recruiterId, role: "admin" }));
    const ids = await clerkIds(db, [a.id, b.id], [a.recruiterId]);

    setAuthReader(async () => ({ userId: ids.users[a.recruiterId], orgId: ids.orgs[b.id] }));
    expect(await requireMember()).toEqual({ userId: a.recruiterId, agencyId: b.id, role: "admin" });

    setAuthReader(async () => ({ userId: ids.users[a.recruiterId], orgId: ids.orgs[a.id] }));
    expect(await requireMember()).toEqual({ userId: a.recruiterId, agencyId: a.id, role: "recruiter" });
  });

  test("signed out redirects to /sign-in", async () => {
    await setup(1);
    setAuthReader(async () => ({ userId: null, orgId: null }));
    expect(await redirectOf(requireMember())).toBe("/sign-in");
  });

  test("signed in with no active org redirects to /no-agency", async () => {
    const { db, agencies: [a] } = await setup(1);
    const ids = await clerkIds(db, [a.id], [a.ownerId]);
    setAuthReader(async () => ({ userId: ids.users[a.ownerId], orgId: null }));
    expect(await redirectOf(requireMember())).toBe("/no-agency");
  });

  test("an active org the user is not a member of (or not yet synced) redirects to /no-agency", async () => {
    const { db, agencies: [a, b] } = await setup();
    const ids = await clerkIds(db, [a.id, b.id], [a.ownerId]);
    setAuthReader(async () => ({ userId: ids.users[a.ownerId], orgId: ids.orgs[b.id] }));
    expect(await redirectOf(requireMember())).toBe("/no-agency");
    setAuthReader(async () => ({ userId: "user_unknown", orgId: ids.orgs[a.id] }));
    expect(await redirectOf(requireMember())).toBe("/no-agency");
    setAuthReader(async () => ({ userId: ids.users[a.ownerId], orgId: "org_unknown" }));
    expect(await redirectOf(requireMember())).toBe("/no-agency");
  });

  test("role comes from our membership row", async () => {
    const { db, agencies: [a] } = await setup(1);
    await asOwner(db, (tx) => tx.update(memberships).set({ role: "admin" }).where(eq(memberships.userId, a.recruiter2Id)));
    const ids = await clerkIds(db, [a.id], [a.recruiter2Id]);
    setAuthReader(async () => ({ userId: ids.users[a.recruiter2Id], orgId: ids.orgs[a.id] }));
    expect((await requireMember()).role).toBe("admin");
  });

  test("without Clerk keys and without a test reader it fails with a clear message", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    await setup(1);
    await expect(requireMember()).rejects.toThrow(/Clerk is not configured/);
    vi.unstubAllEnvs();
  });
});

describe("asMember", () => {
  test("stubs requireMember only for the duration of fn", async () => {
    const { db } = await setup(1);
    const { owner, admin, recA, recB, agency } = await seedMembers(db);
    expect(owner).toEqual({ userId: expect.any(String), agencyId: agency.id, role: "owner" });
    expect(admin.role).toBe("admin");
    expect([recA.role, recB.role]).toEqual(["recruiter", "recruiter"]);
    expect(recA.agencyId).toBe(recB.agencyId);
    expect(recA.userId).not.toBe(recB.userId);

    expect(await asMember(recA, () => requireMember())).toEqual(recA);
    expect(await asMember(owner, async () => [await requireMember(), await asMember(recB, () => requireMember())])).toEqual([
      owner,
      recB,
    ]);
    setAuthReader(async () => ({ userId: null, orgId: null }));
    expect(await redirectOf(requireMember())).toBe("/sign-in");
  });
});

describe("mapClerkRole", () => {
  test("maps org roles and defaults unknown roles to recruiter with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(mapClerkRole("org:owner")).toBe("owner");
    expect(mapClerkRole("org:admin")).toBe("admin");
    expect(mapClerkRole("org:recruiter")).toBe("recruiter");
    expect(warn).not.toHaveBeenCalled();
    expect(mapClerkRole("org:member")).toBe("recruiter");
    expect(warn).toHaveBeenCalledOnce();
  });
});
