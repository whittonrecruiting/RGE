import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mpcConsents, mpcFacts, memberships, mpcs } from "@/db/schema";
import { revalidatePath } from "next/cache";
import { createDraftMpc, createMpc, pauseAllMpcs, reassignMpc, setMpcStatus, updateMpc } from "@/lib/mpc/actions";
import { getMpc, listActiveMembers, listMpcs } from "@/lib/mpc/queries";
import { mpcInput } from "@/lib/mpc/schema";
import type { Member } from "@/lib/auth";
import { asOwner, createTestDb, seedAgencies, type TestDb } from "../helpers/test-db";
import { asMember, membersOf, seedMembers, type MemberFixtures } from "../helpers/as-member";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: TestDb;
let close: (() => Promise<void>) | undefined;
let f: MemberFixtures;

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  close = t.close;
  f = await seedMembers(db);
  vi.mocked(revalidatePath).mockClear();
});
afterEach(async () => {
  await close?.();
  close = undefined;
});

type Input = Parameters<typeof createMpc>[0];
const base = {
  headlineRole: "Senior Litigation Associate",
  location: "Phoenix, AZ",
  yearsExperience: 8,
  payTarget: 185000,
};

const createAs = (m: Member, input: Input) => asMember(m, () => createMpc(input));
const updateMpcAs = (m: Member, id: string, input: Input) => asMember(m, () => updateMpc(id, input));
const getMpcAs = (m: Member, id: string) => asMember(m, () => getMpc(m, id));
const listMpcsAs = (m: Member, filter: Parameters<typeof listMpcs>[1]) => asMember(m, () => listMpcs(m, filter));
const setStatusAs = (m: Member, id: string, s: Parameters<typeof setMpcStatus>[1], reason?: string) =>
  asMember(m, () => setMpcStatus(id, s, reason));
const pauseAllAs = (m: Member, reason: string, scope?: "mine" | "agency") =>
  asMember(m, () => pauseAllMpcs(reason, scope));
const reassignAs = (m: Member, id: string, to: string) => asMember(m, () => reassignMpc(id, to));
const createDraftMpcAs = (m: Member) => asMember(m, () => createDraftMpc());
async function mustDraft(m: Member) {
  const r = await createDraftMpcAs(m);
  if (!r.ok) throw new Error(`draft failed: ${r.error}`);
  return r.id;
}

async function mustCreate(m: Member, input: Input = base) {
  const r = await createAs(m, input);
  if (!r.ok) throw new Error(`create failed: ${r.error}`);
  return r.id;
}

const removeMembership = (userId: string) =>
  asOwner(db, (tx) => tx.update(memberships).set({ status: "removed" }).where(eq(memberships.userId, userId)));

describe("createMpc and updateMpc", () => {
  test("create makes the caller the owner and revalidates", async () => {
    const id = await mustCreate(f.recA);
    const mpc = await getMpcAs(f.recA, id);
    expect(mpc?.ownerUserId).toBe(f.recA.userId);
    expect(mpc?.status).toBe("active");
    expect(revalidatePath).toHaveBeenCalledWith("/mpcs");
  });

  test("recruiter cannot update a teammate MPC via direct call", async () => {
    const id = await mustCreate(f.recA);
    const r = await updateMpcAs(f.recB, id, { ...base, headlineRole: "Changed" });
    expect(r).toEqual({ ok: false, error: "You can only edit your own MPCs." });
    expect((await getMpcAs(f.recA, id))?.headlineRole).toBe(base.headlineRole);
  });

  test("owner, admin and the MPC owner can update", async () => {
    const id = await mustCreate(f.recA);
    for (const [m, title] of [
      [f.recA, "One"],
      [f.admin, "Two"],
      [f.owner, "Three"],
    ] as const) {
      expect((await updateMpcAs(m, id, { ...base, headlineRole: title })).ok).toBe(true);
      expect((await getMpcAs(f.recA, id))?.headlineRole).toBe(title);
    }
    expect(revalidatePath).toHaveBeenCalledWith(`/mpcs/${id}`);
  });

  test("update of an unknown or malformed id is not found", async () => {
    expect(await updateMpcAs(f.recA, "00000000-0000-4000-8000-000000000000", base)).toEqual({
      ok: false,
      error: "MPC not found.",
    });
    expect(await updateMpcAs(f.recA, "not-a-uuid", base)).toEqual({ ok: false, error: "MPC not found." });
  });

  test("another agency cannot see or update an MPC", async () => {
    const id = await mustCreate(f.recA);
    const [other] = await seedAgencies(db, 1);
    const o = membersOf(other).owner;
    expect(await getMpcAs(o, id)).toBeNull();
    expect(await updateMpcAs(o, id, base)).toEqual({ ok: false, error: "MPC not found." });
    expect(await setStatusAs(o, id, "paused")).toEqual({ ok: false, error: "MPC not found." });
  });

  test("blank headline role is rejected", async () => {
    expect((await createAs(f.recA, { headlineRole: "", location: "X" })).ok).toBe(false);
    expect((await createAs(f.recA, { headlineRole: "   ", location: "X" })).ok).toBe(false);
    expect((await createAs(f.recA, { headlineRole: "X", location: "" })).ok).toBe(false);
  });

  test("over-long text, negative numbers and fractional dollars are rejected", async () => {
    const long = "x".repeat(121);
    expect((await createAs(f.recA, { ...base, headlineRole: long })).ok).toBe(false);
    expect((await createAs(f.recA, { ...base, location: long })).ok).toBe(false);
    expect((await createAs(f.recA, { ...base, yearsExperience: -1 })).ok).toBe(false);
    expect((await createAs(f.recA, { ...base, yearsExperience: 2.5 })).ok).toBe(false);
    expect((await createAs(f.recA, { ...base, payTarget: 100.5 })).ok).toBe(false);
    expect((await createAs(f.recA, { ...base, payFloor: -5 })).ok).toBe(false);
    const r = await createAs(f.recA, { ...base, payFloor: 200000, payTarget: 150000 });
    expect(r).toEqual({ ok: false, error: "Pay floor cannot be above pay target." });
  });

  test("a 120 character headline is accepted", async () => {
    expect((await createAs(f.recA, { ...base, headlineRole: "x".repeat(120) })).ok).toBe(true);
  });

  test("tags and cities are trimmed and de-duplicated, from text or arrays", async () => {
    const id = await mustCreate(f.recA, {
      ...base,
      specialtyTags: " Employment ,Litigation, Employment,, Litigation ",
      targetCities: ["Phoenix", " Phoenix ", "Tucson"],
    });
    const mpc = await getMpcAs(f.recA, id);
    expect(mpc?.specialtyTags).toEqual(["Employment", "Litigation"]);
    expect(mpc?.targetCities).toEqual(["Phoenix", "Tucson"]);
  });

  test("numeric text from a form is accepted and blank becomes null", async () => {
    const parsed = mpcInput.parse({ ...base, yearsExperience: "12", payFloor: "", payTarget: "190000" });
    expect(parsed.yearsExperience).toBe(12);
    expect(parsed.payFloor).toBeNull();
    expect(parsed.payTarget).toBe(190000);
  });
});

describe("listMpcs", () => {
  test("missing years and pay target are reported", async () => {
    await mustCreate(f.recA, { headlineRole: "Litigation Associate", location: "Phoenix, AZ" });
    const [row] = await listMpcsAs(f.recA, { owner: "me" });
    expect(row.missing).toEqual(["years", "payTarget"]);
    expect(row.consentOnFile).toBe(false);
    expect(row.interviewOnlyCount).toBe(0);
    expect(row.ownerRemoved).toBe(false);
  });

  test("nothing is missing when both are set", async () => {
    await mustCreate(f.recA);
    const [row] = await listMpcsAs(f.recA, { owner: "me" });
    expect(row.missing).toEqual([]);
  });

  test("consent and interview-only facts are reported", async () => {
    const id = await mustCreate(f.recA);
    await asOwner(db, async (tx) => {
      await tx.insert(mpcConsents).values({
        agencyId: f.agency.id,
        mpcId: id,
        givenOn: "2026-11-01",
        method: "email",
        recordedBy: f.recA.userId,
      });
      await tx.insert(mpcFacts).values([
        { agencyId: f.agency.id, mpcId: id, text: "a", sourceKind: "notes", status: "interview_only" },
        { agencyId: f.agency.id, mpcId: id, text: "b", sourceKind: "notes", status: "interview_only" },
        { agencyId: f.agency.id, mpcId: id, text: "c", sourceKind: "resume", status: "usable" },
      ]);
    });
    const [row] = await listMpcsAs(f.recA, { owner: "me" });
    expect(row.consentOnFile).toBe(true);
    expect(row.interviewOnlyCount).toBe(2);
  });

  test("owner filter separates mine from the team", async () => {
    await mustCreate(f.recA);
    await mustCreate(f.recB);
    await mustCreate(f.recB);
    expect(await listMpcsAs(f.recA, { owner: "me" })).toHaveLength(1);
    expect(await listMpcsAs(f.recA, { owner: "all" })).toHaveLength(3);
  });

  test("status filter works and the default hides removed MPCs", async () => {
    const a = await mustCreate(f.recA);
    const b = await mustCreate(f.recA);
    const c = await mustCreate(f.recA);
    await setStatusAs(f.recA, b, "paused", "Out of market");
    await setStatusAs(f.recA, c, "removed");
    expect((await listMpcsAs(f.recA, { owner: "me" })).map((r) => r.id).sort()).toEqual([a, b].sort());
    expect((await listMpcsAs(f.recA, { owner: "me", status: "paused" })).map((r) => r.id)).toEqual([b]);
    expect((await listMpcsAs(f.recA, { owner: "me", status: "removed" })).map((r) => r.id)).toEqual([c]);
  });

  test("another agency's MPCs never appear", async () => {
    await mustCreate(f.recA);
    const [other] = await seedAgencies(db, 1);
    expect(await listMpcsAs(membersOf(other).owner, { owner: "all" })).toEqual([]);
  });
});

describe("setMpcStatus", () => {
  test("pause stores the reason and resume clears it", async () => {
    const id = await mustCreate(f.recA);
    expect((await setStatusAs(f.recA, id, "paused", "  On vacation  ")).ok).toBe(true);
    let mpc = await getMpcAs(f.recA, id);
    expect(mpc?.status).toBe("paused");
    expect(mpc?.pauseReason).toBe("On vacation");
    expect((await setStatusAs(f.recA, id, "active")).ok).toBe(true);
    mpc = await getMpcAs(f.recA, id);
    expect(mpc?.status).toBe("active");
    expect(mpc?.pauseReason).toBeNull();
  });

  test("removed is allowed, placed is not settable", async () => {
    const id = await mustCreate(f.recA);
    expect((await setStatusAs(f.recA, id, "placed" as never)).ok).toBe(false);
    expect((await getMpcAs(f.recA, id))?.status).toBe("active");
    expect((await setStatusAs(f.recA, id, "removed")).ok).toBe(true);
    expect((await getMpcAs(f.recA, id))?.status).toBe("removed");
  });

  test("a placed MPC cannot be changed here", async () => {
    const id = await mustCreate(f.recA);
    await asOwner(db, (tx) => tx.update(mpcs).set({ status: "placed" }).where(eq(mpcs.id, id)));
    const r = await setStatusAs(f.recA, id, "active");
    expect(r.ok).toBe(false);
    expect((await getMpcAs(f.recA, id))?.status).toBe("placed");
  });

  test("recruiter cannot change a teammate MPC, admin can", async () => {
    const id = await mustCreate(f.recA);
    expect(await setStatusAs(f.recB, id, "paused")).toEqual({ ok: false, error: "You can only edit your own MPCs." });
    expect((await getMpcAs(f.recA, id))?.status).toBe("active");
    expect((await setStatusAs(f.admin, id, "paused")).ok).toBe(true);
  });
});

describe("pauseAllMpcs", () => {
  async function setup() {
    const a1 = await mustCreate(f.recA);
    const a2 = await mustCreate(f.recA);
    const b1 = await mustCreate(f.recB);
    return { a1, a2, b1 };
  }

  test("pause all pauses only my active MPCs", async () => {
    const { a1, a2, b1 } = await setup();
    const r = await pauseAllAs(f.recA, "Vacation");
    expect(r).toEqual({ ok: true, count: 2 });
    expect((await getMpcAs(f.recA, a1))?.status).toBe("paused");
    expect((await getMpcAs(f.recA, a2))?.status).toBe("paused");
    expect((await getMpcAs(f.recA, a2))?.pauseReason).toBe("Vacation");
    expect((await getMpcAs(f.recA, b1))?.status).toBe("active");
  });

  test("does not touch already paused or removed MPCs", async () => {
    const { a1, a2 } = await setup();
    await setStatusAs(f.recA, a1, "removed");
    await setStatusAs(f.recA, a2, "paused", "Earlier reason");
    expect(await pauseAllAs(f.recA, "Vacation")).toEqual({ ok: true, count: 0 });
    expect((await getMpcAs(f.recA, a1))?.status).toBe("removed");
    expect((await getMpcAs(f.recA, a2))?.pauseReason).toBe("Earlier reason");
  });

  test("recruiter cannot pause the whole agency", async () => {
    const { b1 } = await setup();
    const r = await pauseAllAs(f.recA, "x", "agency");
    expect(r).toEqual({ ok: false, error: "You do not have permission to pause the whole agency." });
    expect((await getMpcAs(f.recA, b1))?.status).toBe("active");
  });

  test("admin can pause the whole agency", async () => {
    const { a1, b1 } = await setup();
    expect(await pauseAllAs(f.admin, "Holiday", "agency")).toEqual({ ok: true, count: 3 });
    expect((await getMpcAs(f.recA, a1))?.status).toBe("paused");
    expect((await getMpcAs(f.recA, b1))?.status).toBe("paused");
  });

  test("admin default scope is only their own MPCs", async () => {
    const { a1 } = await setup();
    expect(await pauseAllAs(f.admin, "x")).toEqual({ ok: true, count: 0 });
    expect((await getMpcAs(f.recA, a1))?.status).toBe("active");
  });

  test("another agency is untouched by an agency-wide pause", async () => {
    await setup();
    const [other] = await seedAgencies(db, 1);
    const o = membersOf(other);
    const oid = await mustCreate(o.recA);
    await pauseAllAs(f.owner, "x", "agency");
    expect((await getMpcAs(o.owner, oid))?.status).toBe("active");
  });
});

describe("reassignMpc", () => {
  test("recruiter cannot reassign, even their own MPC", async () => {
    const id = await mustCreate(f.recA);
    expect(await reassignAs(f.recA, id, f.recB.userId)).toEqual({
      ok: false,
      error: "You do not have permission to reassign MPCs.",
    });
    expect((await getMpcAs(f.recA, id))?.ownerUserId).toBe(f.recA.userId);
  });

  test("owner and admin can reassign to an active member", async () => {
    const id = await mustCreate(f.recA);
    expect((await reassignAs(f.admin, id, f.recB.userId)).ok).toBe(true);
    expect((await getMpcAs(f.recA, id))?.ownerUserId).toBe(f.recB.userId);
    expect((await reassignAs(f.owner, id, f.recA.userId)).ok).toBe(true);
    expect((await getMpcAs(f.recA, id))?.ownerUserId).toBe(f.recA.userId);
    expect(revalidatePath).toHaveBeenCalledWith(`/mpcs/${id}`);
  });

  test("the new owner must be an active member of this agency", async () => {
    const id = await mustCreate(f.recA);
    const NOT_ACTIVE = { ok: false, error: "Choose an active member of your team." };
    await removeMembership(f.recB.userId);
    expect(await reassignAs(f.admin, id, f.recB.userId)).toEqual(NOT_ACTIVE);
    const [other] = await seedAgencies(db, 1);
    expect(await reassignAs(f.admin, id, other.ownerId)).toEqual(NOT_ACTIVE);
    expect(await reassignAs(f.admin, id, "not-a-uuid")).toEqual(NOT_ACTIVE);
    expect((await getMpcAs(f.recA, id))?.ownerUserId).toBe(f.recA.userId);
  });

  test("unknown MPC is not found", async () => {
    expect(await reassignAs(f.admin, "00000000-0000-4000-8000-000000000000", f.recB.userId)).toEqual({
      ok: false,
      error: "MPC not found.",
    });
  });

  test("an MPC whose owner was removed is flagged ownerRemoved", async () => {
    const id = await mustCreate(f.recA);
    await removeMembership(f.recA.userId);
    const [row] = await listMpcsAs(f.admin, { owner: "all" });
    expect(row.ownerRemoved).toBe(true);
    expect((await getMpcAs(f.admin, id))?.ownerRemoved).toBe(true);
    expect((await reassignAs(f.admin, id, f.recB.userId)).ok).toBe(true);
    const [after] = await listMpcsAs(f.admin, { owner: "all" });
    expect(after.ownerRemoved).toBe(false);
  });
});

describe("listActiveMembers", () => {
  test("lists active members of the agency only", async () => {
    await removeMembership(f.recB.userId);
    const people = await asMember(f.admin, () => listActiveMembers(f.admin));
    expect(people.map((p) => p.userId).sort()).toEqual([f.owner.userId, f.admin.userId, f.recA.userId].sort());
  });
});

describe("draft MPCs", () => {
  test("createDraftMpc saves a draft with no fields", async () => {
    const r = await createDraftMpcAs(f.recA);
    if (!r.ok) throw new Error(r.error);
    const mpc = await getMpcAs(f.recA, r.id);
    expect(mpc?.status).toBe("draft");
    expect(mpc?.ownerUserId).toBe(f.recA.userId);
    expect(mpc?.headlineRole).toBeNull();
    expect(mpc?.location).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/mpcs");
  });

  test("database rejects an active MPC without a role or location", async () => {
    const insert = (values: { status: "active" | "paused" | "draft"; headlineRole: string | null; location: string | null }) =>
      asOwner(db, (tx) =>
        tx.insert(mpcs).values({ agencyId: f.agency.id, ownerUserId: f.recA.userId, ...values }).returning({ id: mpcs.id }),
      );
    await expect(insert({ status: "active", headlineRole: null, location: "Phoenix, AZ" })).rejects.toThrow();
    await expect(insert({ status: "paused", headlineRole: "Associate", location: null })).rejects.toThrow();
    await expect(insert({ status: "draft", headlineRole: null, location: null })).resolves.toHaveLength(1);
  });

  test("a draft activates when role and location are both set", async () => {
    const id = await mustDraft(f.recA);
    const first = await updateMpcAs(f.recA, id, { location: "Phoenix, AZ" } as Input);
    expect(first).toEqual({ ok: true });
    expect((await getMpcAs(f.recA, id))?.status).toBe("draft");
    expect((await getMpcAs(f.recA, id))?.location).toBe("Phoenix, AZ");
    const r = await updateMpcAs(f.recA, id, { headlineRole: "Litigation Associate", location: "Phoenix, AZ" });
    expect(r).toMatchObject({ ok: true, activated: true });
    expect((await getMpcAs(f.recA, id))?.status).toBe("active");
  });

  test("draft updates still validate the other fields", async () => {
    const id = await mustDraft(f.recA);
    expect((await updateMpcAs(f.recA, id, { yearsExperience: -1 } as Input)).ok).toBe(false);
    expect((await updateMpcAs(f.recA, id, { headlineRole: "x".repeat(121) } as Input)).ok).toBe(false);
  });

  test("a teammate recruiter cannot edit a draft", async () => {
    const id = await mustDraft(f.recA);
    expect(await updateMpcAs(f.recB, id, base)).toEqual({ ok: false, error: "You can only edit your own MPCs." });
  });

  test("cannot set a draft active without required fields", async () => {
    const id = await mustDraft(f.recA);
    expect(await setStatusAs(f.recA, id, "active")).toEqual({
      ok: false,
      error: "Add the headline role and location before activating.",
    });
    expect((await getMpcAs(f.recA, id))?.status).toBe("draft");
  });

  test("an incomplete draft cannot be paused or removed", async () => {
    const id = await mustDraft(f.recA);
    const NO = { ok: false, error: "A draft cannot be paused or removed until it has a headline role and location." };
    expect(await setStatusAs(f.recA, id, "paused", "x")).toEqual(NO);
    expect(await setStatusAs(f.recA, id, "removed")).toEqual(NO);
    expect((await getMpcAs(f.recA, id))?.status).toBe("draft");
  });

  test("an activated draft behaves like any other MPC", async () => {
    const id = await mustDraft(f.recA);
    await updateMpcAs(f.recA, id, base);
    expect((await setStatusAs(f.recA, id, "removed")).ok).toBe(true);
    expect((await setStatusAs(f.recA, id, "active")).ok).toBe(true);
    expect((await updateMpcAs(f.recA, id, { ...base, location: "" })).ok).toBe(false);
  });

  test("pause all skips drafts", async () => {
    const d = await mustDraft(f.recA);
    const a = await mustCreate(f.recA);
    expect(await pauseAllAs(f.recA, "Vacation")).toEqual({ ok: true, count: 1 });
    expect((await getMpcAs(f.recA, d))?.status).toBe("draft");
    expect((await getMpcAs(f.recA, a))?.status).toBe("paused");
  });

  test("listMpcs shows drafts with missing role and location first", async () => {
    await mustDraft(f.recA);
    const [row] = await listMpcsAs(f.recA, { owner: "me" });
    expect(row.status).toBe("draft");
    expect(row.headlineRole).toBeNull();
    expect(row.missing.slice(0, 2)).toEqual(["headlineRole", "location"]);
    expect((await listMpcsAs(f.recA, { owner: "me", status: "draft" })).map((r) => r.id)).toEqual([row.id]);
  });

  test("non-draft update still requires headline role", async () => {
    const id = await mustCreate(f.recA);
    expect((await updateMpcAs(f.recA, id, { ...base, headlineRole: "" })).ok).toBe(false);
    expect((await updateMpcAs(f.recA, id, { ...base, location: "" })).ok).toBe(false);
    const ok = await updateMpcAs(f.recA, id, base);
    expect(ok).toEqual({ ok: true });
  });

  test("an admin can reassign a draft", async () => {
    const id = await mustDraft(f.recA);
    expect((await reassignAs(f.admin, id, f.recB.userId)).ok).toBe(true);
    expect((await getMpcAs(f.recB, id))?.ownerUserId).toBe(f.recB.userId);
  });
});
