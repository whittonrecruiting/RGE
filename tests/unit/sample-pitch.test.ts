import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { aiUsage, agencySettings } from "@/db/schema";
import { createDraftMpc, createMpc } from "@/lib/mpc/actions";
import { deleteFact, setRestrictions, updateFact } from "@/lib/mpc/fact-actions";
import { clearSavedBullets, generateSamplePitch, saveBullets } from "@/lib/mpc/sample-pitch-action";
import { getPitchReadiness, listMpcs, listSavedBullets } from "@/lib/mpc/queries";
import { MODELS, setTestGenerate } from "@/lib/ai/models";
import { USER_HOURLY_LIMIT_ERROR } from "@/lib/ai/usage";
import { DEFAULT_SETTINGS } from "@/lib/settings-defaults";
import type { Member } from "@/lib/auth";
import { asOwner, createTestDb, seedFact, type TestDb } from "../helpers/test-db";
import { asMember, seedMembers, type MemberFixtures } from "../helpers/as-member";
import { fakeGenerate } from "../helpers/fake-ai";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: TestDb;
let close: (() => Promise<void>) | undefined;
let f: MemberFixtures;

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  close = t.close;
  f = await seedMembers(db);
});
afterEach(async () => {
  setTestGenerate(undefined);
  await close?.();
  close = undefined;
});

async function newMpc(m: Member = f.recA) {
  const r = await asMember(m, () => createMpc({ headlineRole: "Senior litigation associate", location: "Phoenix, AZ" }));
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

const FACTS = {
  a: "Tried 4 insurance coverage cases to verdict",
  b: "Led discovery on a $120M bad faith matter",
  c: "Drafted dispositive motions for national carriers",
  d: "Argued 2 appeals before the Ninth Circuit",
};

/** An active MPC with three usable or confirmed facts, one interview-only fact and one spare. */
async function mpcWithFacts() {
  const id = await newMpc();
  const a = await seedFact(db, { agencyId: f.agency.id, mpcId: id, text: FACTS.a, status: "usable" });
  const b = await seedFact(db, { agencyId: f.agency.id, mpcId: id, text: FACTS.b, status: "confirmed" });
  const c = await seedFact(db, { agencyId: f.agency.id, mpcId: id, text: FACTS.c, status: "usable" });
  const hidden = await seedFact(db, {
    agencyId: f.agency.id,
    mpcId: id,
    text: "Wants to leave because of a difficult partner",
    status: "interview_only",
  });
  return { id, a: a.id, b: b.id, c: c.id, hidden: hidden.id };
}

const BACKGROUND = "insurance coverage litigation";
const good = (ids: { a: string; b: string; c: string }) => [
  { factId: ids.a, text: "Tried 4 coverage cases to verdict" },
  { factId: ids.b, text: "Led discovery on a $120M bad faith matter" },
  { factId: ids.c, text: "Drafted dispositive motions for national carriers" },
];

const generateAs = (m: Member, id: string, opts?: Parameters<typeof generateSamplePitch>[1]) =>
  asMember(m, () => generateSamplePitch(id, opts));
const usageRows = () => asOwner(db, (tx) => tx.select().from(aiUsage));

describe("generateSamplePitch", () => {
  test("three good bullets render with the agency template, subject and opt-out line", async () => {
    const ids = await mpcWithFacts();
    setTestGenerate(fakeGenerate({ background: BACKGROUND, bullets: good(ids) }));
    const r = await generateAs(f.recA, ids.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pitch.subject).toBe("Senior litigation associate?");
    expect(r.pitch.warnings).toEqual([]);
    expect(r.pitch.bullets).toEqual(good(ids));
    expect(r.pitch.body).toBe(
      [
        "Hi [First Name],",
        "",
        `I'm working with a Phoenix, AZ senior litigation associate whose ${BACKGROUND} could be relevant to your team:`,
        "",
        "- Tried 4 coverage cases to verdict",
        "- Led discovery on a $120M bad faith matter",
        "- Drafted dispositive motions for national carriers",
        "",
        "Would you be open to a call to discuss?",
        "",
        "Best,",
        "",
        DEFAULT_SETTINGS.templates.optOut,
      ].join("\n"),
    );
    expect(r.pitch.body).not.toContain(String.fromCharCode(0x2014));
  });

  test("bullets from interview-only facts, another MPC's facts or failing the guard are dropped, with a warning", async () => {
    const ids = await mpcWithFacts();
    const otherMpc = await newMpc(f.recB);
    const foreign = await seedFact(db, { agencyId: f.agency.id, mpcId: otherMpc, text: FACTS.d, status: "usable" });
    setTestGenerate(
      fakeGenerate({
        background: BACKGROUND,
        bullets: [
          { factId: ids.hidden, text: "Wants to leave a difficult partner" },
          { factId: foreign.id, text: "Argued 2 appeals before the Ninth Circuit" },
          { factId: ids.b, text: "Led discovery on a $500M bad faith matter" },
          { factId: ids.a, text: "Tried 4 coverage cases to verdict" },
        ],
      }),
    );
    const r = await generateAs(f.recA, ids.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pitch.bullets).toEqual([{ factId: ids.a, text: "Tried 4 coverage cases to verdict" }]);
    expect(r.pitch.warnings).toEqual(["Only 1 bullet passed the checks. Regenerate to try again."]);
    expect(r.pitch.body).not.toContain("difficult partner");
    expect(r.pitch.body).not.toContain("Ninth Circuit");
    expect(r.pitch.body).not.toContain("$500M");
  });

  test("with fewer than three strong facts the warning explains why", async () => {
    const id = await newMpc();
    const a = await seedFact(db, { agencyId: f.agency.id, mpcId: id, text: FACTS.a });
    const b = await seedFact(db, { agencyId: f.agency.id, mpcId: id, text: FACTS.b, status: "confirmed" });
    setTestGenerate(fakeGenerate({ background: BACKGROUND, bullets: good({ a: a.id, b: b.id, c: "x" }).slice(0, 2) }));
    const r = await generateAs(f.recA, id);
    expect(r.ok && r.pitch.warnings).toEqual(["Only 2 strong facts. Confirm a note or run Find more."]);
  });

  test("a background phrase that fails the checks is left as the placeholder, with a warning", async () => {
    const ids = await mpcWithFacts();
    setTestGenerate(fakeGenerate({ background: "award winning 15 year litigation career", bullets: good(ids) }));
    const r = await generateAs(f.recA, ids.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pitch.body).toContain("whose [specific background] could be relevant");
    expect(r.pitch.warnings).toContain("The background phrase did not pass the checks. Regenerate to try again.");
  });

  test("never-say and confidential restrictions drop a bullet", async () => {
    const ids = await mpcWithFacts();
    await asOwner(db, (tx) =>
      tx.execute(
        sql`insert into mpc_restrictions (agency_id, mpc_id, kind, value) values (${f.agency.id}, ${ids.id}, 'never_say', 'bad faith')`,
      ),
    );
    setTestGenerate(fakeGenerate({ background: BACKGROUND, bullets: good(ids) }));
    const r = await generateAs(f.recA, ids.id);
    expect(r.ok && r.pitch.bullets.map((b) => b.factId)).toEqual([ids.a, ids.c]);
  });

  test("a Draft MPC is refused before any AI call", async () => {
    const d = await asMember(f.recA, () => createDraftMpc());
    if (!d.ok) throw new Error(d.error);
    const gen = fakeGenerate({ background: BACKGROUND, bullets: [] });
    setTestGenerate(gen);
    expect(await generateAs(f.recA, d.id)).toEqual({ ok: false, error: "Activate this MPC before previewing a pitch." });
    expect(gen.calls).toHaveLength(0);
    expect(await usageRows()).toHaveLength(0);
  });

  test("with no strong facts and nothing saved, it says so before any AI call", async () => {
    const id = await newMpc();
    await seedFact(db, { agencyId: f.agency.id, mpcId: id, text: "Wants to leave a difficult partner", status: "interview_only" });
    const gen = fakeGenerate({ background: BACKGROUND, bullets: [] });
    setTestGenerate(gen);
    expect(await generateAs(f.recA, id)).toEqual({ ok: false, error: "No strong facts yet. Confirm a note or run Find more." });
    expect(gen.calls).toHaveLength(0);
    expect(await usageRows()).toHaveLength(0);
  });

  test("a background phrase is not rendered when no bullet facts were used", async () => {
    const id = await newMpc();
    const b = await seedFact(db, { agencyId: f.agency.id, mpcId: id, text: FACTS.b, status: "usable" });
    setTestGenerate(
      fakeGenerate({ background: BACKGROUND, bullets: [{ factId: b.id, text: "Led discovery on a $500M bad faith matter" }] }),
    );
    const r = await generateAs(f.recA, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pitch.bullets).toEqual([]);
    expect(r.pitch.body).not.toContain(BACKGROUND);
    expect(r.pitch.body).toContain("whose [specific background] could be relevant");
    expect(r.pitch.warnings).toContain("The background phrase did not pass the checks. Regenerate to try again.");
  });

  test("removed and placed MPCs are refused before any AI call", async () => {
    const ids = await mpcWithFacts();
    const gen = fakeGenerate({ background: BACKGROUND, bullets: good(ids) });
    setTestGenerate(gen);
    await asOwner(db, (tx) => tx.execute(sql`update mpcs set status = 'removed' where id = ${ids.id}`));
    expect(await generateAs(f.recA, ids.id)).toEqual({ ok: false, error: "Restore this MPC before previewing a pitch." });
    await asOwner(db, (tx) => tx.execute(sql`update mpcs set status = 'placed' where id = ${ids.id}`));
    expect(await generateAs(f.recA, ids.id)).toEqual({ ok: false, error: "This MPC is placed." });
    expect(gen.calls).toHaveLength(0);
    expect(await usageRows()).toHaveLength(0);
  });

  test("only members who can edit the MPC may generate", async () => {
    const ids = await mpcWithFacts();
    setTestGenerate(fakeGenerate({ background: BACKGROUND, bullets: good(ids) }));
    expect(await generateAs(f.recB, ids.id)).toEqual({ ok: false, error: "You can only edit your own MPCs." });
    expect((await generateAs(f.admin, ids.id)).ok).toBe(true);
  });

  test("a template without three [bullet] lines is an error, not a render", async () => {
    const ids = await mpcWithFacts();
    await asOwner(db, (tx) =>
      tx.insert(agencySettings).values({
        agencyId: f.agency.id,
        values: { templates: { pitch: "Hi [First Name],\n\n- [bullet]\n- [bullet]\n\nBest," } },
      }),
    );
    const gen = fakeGenerate({ background: BACKGROUND, bullets: good(ids) });
    setTestGenerate(gen);
    expect(await generateAs(f.recA, ids.id)).toEqual({
      ok: false,
      error: "The pitch template needs three [bullet] lines. Fix it in Settings.",
    });
    expect(gen.calls).toHaveLength(0);
  });

  test("records one ai_usage row with purpose sample_pitch, and the rate limit applies", async () => {
    const ids = await mpcWithFacts();
    setTestGenerate(fakeGenerate({ background: BACKGROUND, bullets: good(ids) }, { inputTokens: 900, outputTokens: 120, webSearches: 0 }));
    expect((await generateAs(f.recA, ids.id)).ok).toBe(true);
    expect(await usageRows()).toEqual([
      expect.objectContaining({ userId: f.recA.userId, purpose: "sample_pitch", model: MODELS.extract, inputTokens: 900 }),
    ]);

    await asOwner(db, (tx) =>
      tx.insert(aiUsage).values(
        Array.from({ length: 29 }, () => ({
          agencyId: f.agency.id,
          userId: f.recA.userId,
          purpose: "sample_pitch" as const,
          model: "seed",
        })),
      ),
    );
    const gen = fakeGenerate({ background: BACKGROUND, bullets: good(ids) });
    setTestGenerate(gen);
    expect(await generateAs(f.recA, ids.id)).toEqual({ ok: false, error: USER_HOURLY_LIMIT_ERROR });
    expect(gen.calls).toHaveLength(0);
  });

  test("a failed model call says so and is still metered", async () => {
    const ids = await mpcWithFacts();
    setTestGenerate((async () => {
      throw new Error("boom");
    }) as never);
    expect(await generateAs(f.recA, ids.id)).toEqual({ ok: false, error: "The sample pitch did not finish. Try again." });
    expect(await usageRows()).toHaveLength(1);
  });
});

describe("saved bullets", () => {
  async function savedMpc() {
    const ids = await mpcWithFacts();
    const r = await asMember(f.recA, () => saveBullets(ids.id, good(ids)));
    expect(r).toEqual({ ok: true });
    return ids;
  }
  const savedOf = (id: string) => asMember(f.recA, () => listSavedBullets(f.recA, id));

  test("saveBullets stores three checked bullets in order and replaces earlier ones", async () => {
    const ids = await savedMpc();
    expect(await savedOf(ids.id)).toEqual(good(ids).map((b, i) => ({ position: i + 1, ...b })));
    const reordered = [good(ids)[2], good(ids)[0], good(ids)[1]];
    expect(await asMember(f.recA, () => saveBullets(ids.id, reordered))).toEqual({ ok: true });
    expect((await savedOf(ids.id)).map((b) => b.factId)).toEqual([ids.c, ids.a, ids.b]);
  });

  test("saveBullets rechecks every bullet against its stored fact", async () => {
    const ids = await mpcWithFacts();
    const inflated = good(ids).map((b) => (b.factId === ids.b ? { ...b, text: "Led discovery on a $500M bad faith matter" } : b));
    const r = await asMember(f.recA, () => saveBullets(ids.id, inflated));
    expect(r.ok).toBe(false);
    expect(await asMember(f.recA, () => saveBullets(ids.id, good(ids).slice(0, 2)))).toEqual({
      ok: false,
      error: "Choose exactly three bullets.",
    });
    const hidden = good(ids).map((b, i) => (i === 0 ? { factId: ids.hidden, text: "Wants to leave a difficult partner" } : b));
    expect((await asMember(f.recA, () => saveBullets(ids.id, hidden))).ok).toBe(false);
    expect(await asMember(f.recB, () => saveBullets(ids.id, good(ids)))).toEqual({
      ok: false,
      error: "You can only edit your own MPCs.",
    });
    expect(await savedOf(ids.id)).toEqual([]);
  });

  test("saved bullets are used and only the swapped position changes", async () => {
    const ids = await savedMpc();
    const d = await seedFact(db, { agencyId: f.agency.id, mpcId: ids.id, text: FACTS.d, status: "usable" });
    const gen = fakeGenerate({
      background: BACKGROUND,
      bullets: [
        { factId: ids.b, text: "Led discovery on a $120M bad faith matter" },
        { factId: d.id, text: "Argued 2 appeals before the Ninth Circuit" },
      ],
    });
    setTestGenerate(gen);
    const r = await generateAs(f.recA, ids.id, { swapPosition: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pitch.bullets).toEqual([
      good(ids)[0],
      { factId: d.id, text: "Argued 2 appeals before the Ninth Circuit" },
      good(ids)[2],
    ]);
    // The swapped-out fact is not offered to the model again.
    expect(gen.calls[0].prompt).not.toContain(ids.b);
    // Previewing a swap does not change what is saved.
    expect((await savedOf(ids.id)).map((b) => b.factId)).toEqual([ids.a, ids.b, ids.c]);

    // Without a swap, all three saved bullets are used as they are.
    setTestGenerate(fakeGenerate({ background: BACKGROUND, bullets: [{ factId: d.id, text: "Argued 2 appeals before the Ninth Circuit" }] }));
    const again = await generateAs(f.recA, ids.id);
    expect(again.ok && again.pitch.bullets).toEqual(good(ids));
  });

  test("bad keep input is dropped and rewritten; a keep item cannot choose its position", async () => {
    const ids = await mpcWithFacts();
    const otherMpc = await newMpc(f.recB);
    const foreign = await seedFact(db, { agencyId: f.agency.id, mpcId: otherMpc, text: FACTS.d, status: "usable" });
    const [a, b, c] = good(ids);

    const gen = fakeGenerate({ background: BACKGROUND, bullets: [b, c] });
    setTestGenerate(gen);
    const r = await generateAs(f.recA, ids.id, {
      keep: [
        { ...a, position: 3 } as typeof a, // valid, but the position comes from the index
        { factId: ids.hidden, text: "Wants to leave a difficult partner" }, // interview-only
        { factId: foreign.id, text: "Argued 2 appeals before the Ninth Circuit" }, // another MPC's fact
      ],
    });
    expect(r.ok && r.pitch.bullets).toEqual([a, b, c]);
    expect(r.ok && r.pitch.body).not.toMatch(/difficult partner|Ninth Circuit/);
    expect(gen.calls[0].prompt).not.toContain(ids.hidden);
    expect(gen.calls[0].prompt).not.toContain(foreign.id);

    setTestGenerate(fakeGenerate({ background: BACKGROUND, bullets: [b] }));
    const inflated = await generateAs(f.recA, ids.id, {
      keep: [{ factId: ids.b, text: "Led discovery on a $500M bad faith matter" }, a, c],
    });
    expect(inflated.ok && inflated.pitch.bullets).toEqual([b, a, c]);
    expect(inflated.ok && inflated.pitch.body).not.toContain("$500M");
  });

  test("swapping with no other strong fact left is an error", async () => {
    const ids = await savedMpc();
    const gen = fakeGenerate({ background: BACKGROUND, bullets: [] });
    setTestGenerate(gen);
    expect(await generateAs(f.recA, ids.id, { swapPosition: 1 })).toEqual({
      ok: false,
      error: "No other strong fact to swap in. Confirm a note or run Find more.",
    });
    expect(gen.calls).toHaveLength(0);
  });

  test("editing a saved fact removes its saved bullet; deleting one cascades", async () => {
    const ids = await savedMpc();
    expect(await asMember(f.recA, () => updateFact(ids.b, "Led discovery on a $90M bad faith matter"))).toEqual({ ok: true });
    expect((await savedOf(ids.id)).map((b) => b.factId)).toEqual([ids.a, ids.c]);
    expect(await asMember(f.recA, () => deleteFact(ids.c))).toEqual({ ok: true });
    expect((await savedOf(ids.id)).map((b) => b.factId)).toEqual([ids.a]);
  });

  test("setRestrictions removes saved bullets that use a never-say or confidential term", async () => {
    const ids = await savedMpc();
    expect(
      await asMember(f.recA, () =>
        setRestrictions(ids.id, [
          { kind: "never_say", value: "bad faith" },
          { kind: "excluded_company", value: "national carriers" },
        ]),
      ),
    ).toEqual({ ok: true });
    expect((await savedOf(ids.id)).map((b) => b.factId)).toEqual([ids.a, ids.c]);
    expect(await asMember(f.recA, () => setRestrictions(ids.id, [{ kind: "confidential", value: "Coverage" }]))).toEqual({ ok: true });
    expect((await savedOf(ids.id)).map((b) => b.factId)).toEqual([ids.c]);
  });

  test("clearSavedBullets removes them all", async () => {
    const ids = await savedMpc();
    expect(await asMember(f.recB, () => clearSavedBullets(ids.id))).toEqual({ ok: false, error: "You can only edit your own MPCs." });
    expect(await asMember(f.recA, () => clearSavedBullets(ids.id))).toEqual({ ok: true });
    expect(await savedOf(ids.id)).toEqual([]);
  });
});

describe("pitch readiness", () => {
  test("ready with three usable or confirmed facts, or three saved bullets; any member may see it", async () => {
    const id = await newMpc();
    await seedFact(db, { agencyId: f.agency.id, mpcId: id, text: FACTS.a });
    await seedFact(db, { agencyId: f.agency.id, mpcId: id, text: FACTS.b, status: "confirmed" });
    await seedFact(db, { agencyId: f.agency.id, mpcId: id, text: FACTS.c, status: "interview_only" });
    const rowOf = async () => (await asMember(f.recB, () => listMpcs(f.recB, { owner: "all" }))).find((r) => r.id === id)!;
    expect((await rowOf()).pitchReady).toBe(false);
    expect(await asMember(f.recB, () => getPitchReadiness(f.recB, id))).toEqual({
      strongFactCount: 2,
      savedCount: 0,
      pitchReady: false,
    });
    await seedFact(db, { agencyId: f.agency.id, mpcId: id, text: FACTS.d });
    expect((await rowOf()).pitchReady).toBe(true);
    expect((await asMember(f.recB, () => getPitchReadiness(f.recB, id))).pitchReady).toBe(true);
  });
});
