import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMpc } from "@/lib/mpc/actions";
import { applyFindMore, runFindMore } from "@/lib/mpc/find-more-action";
import { listFacts } from "@/lib/mpc/document-queries";
import { setTestGenerate } from "@/lib/ai/models";
import type { Member } from "@/lib/auth";
import { createTestDb, type TestDb } from "../helpers/test-db";
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
  process.env.RGE_DRAFT_SECRET = "test-secret-for-draft-signing";
});
afterEach(async () => {
  delete process.env.RGE_DRAFT_SECRET;
  setTestGenerate(undefined);
  await close?.();
  close = undefined;
});

const Q1 = "Published an article on first-party coverage disputes";
const Q2 = "Named to the 2025 list of top insurance lawyers";
const out = {
  facts: [
    { text: "Published an article on coverage disputes", url: "https://example.test/a", quote: Q1 },
    { text: "Named a top insurance lawyer", url: "https://example.test/b", quote: Q2 },
    { text: "Dropped, no https", url: "http://example.test/c", quote: Q1 },
  ],
};
async function newMpc(m: Member) {
  const r = await asMember(m, () =>
    createMpc({ headlineRole: "Senior Litigation Associate", location: "Phoenix, AZ", yearsExperience: 8 }),
  );
  if (!r.ok) throw new Error(r.error);
  return r.id;
}
const factsOf = (m: Member, id: string) => asMember(m, () => listFacts(m, id));
const STALE = { ok: false, error: "This review is out of date. Run the search again." };

async function signed(id: string, m: Member = f.recA) {
  setTestGenerate(fakeGenerate(out));
  const r = await asMember(m, () => runFindMore(id, "currently at Example LLP"));
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("runFindMore", () => {
  test("returns a signed draft of https facts, saves nothing, never includes hints", async () => {
    const id = await newMpc(f.recA);
    const r = await signed(id);
    expect(r.draft.facts).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain("Example LLP");
    expect(await factsOf(f.recA, id)).toHaveLength(0);
  });

  test("checks permission, config and failures", async () => {
    const id = await newMpc(f.recA);
    setTestGenerate(fakeGenerate(out));
    expect(await asMember(f.recB, () => runFindMore(id, ""))).toEqual({
      ok: false,
      error: "You can only edit your own MPCs.",
    });
    setTestGenerate((async () => {
      throw new Error("boom");
    }) as never);
    expect(await asMember(f.recA, () => runFindMore(id, ""))).toEqual({
      ok: false,
      error: "The search did not finish. Try again.",
    });
    delete process.env.RGE_DRAFT_SECRET;
    expect((await asMember(f.recA, () => runFindMore(id, ""))).ok).toBe(false);
  });

  test("rejects an oversized hints box", async () => {
    const id = await newMpc(f.recA);
    setTestGenerate(fakeGenerate(out));
    const r = await asMember(f.recA, () => runFindMore(id, "x".repeat(2001)));
    expect(r.ok).toBe(false);
  });
});

describe("applyFindMore", () => {
  test("saves only accepted indexes as usable web facts", async () => {
    const id = await newMpc(f.recA);
    const s = await signed(id);
    const r = await asMember(f.recA, () => applyFindMore(id, { ...s, factIndexes: [1, 1, 9, -1] }));
    expect(r).toEqual({ ok: true });
    const facts = await factsOf(f.recA, id);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      text: "Named a top insurance lawyer",
      sourceKind: "web",
      sourceRef: "https://example.test/b",
      sourceQuote: Q2,
      status: "usable",
    });
  });

  test("skips a fact already saved with the same text and url", async () => {
    const id = await newMpc(f.recA);
    const s = await signed(id);
    await asMember(f.recA, () => applyFindMore(id, { ...s, factIndexes: [0] }));
    await asMember(f.recA, () => applyFindMore(id, { ...s, factIndexes: [0, 1] }));
    expect(await factsOf(f.recA, id)).toHaveLength(2);
  });

  test("rejects altered, foreign and unsigned drafts", async () => {
    const id = await newMpc(f.recA);
    const other = await newMpc(f.recA);
    const s = await signed(id);
    const altered = { ...s, draft: { ...s.draft, facts: [{ ...s.draft.facts[0], url: "https://evil.test/x" }] } };
    expect(await asMember(f.recA, () => applyFindMore(id, { ...altered, factIndexes: [0] }))).toEqual(STALE);
    expect(await asMember(f.recA, () => applyFindMore(other, { ...s, factIndexes: [0] }))).toEqual(STALE);
    expect(await asMember(f.recA, () => applyFindMore(id, { ...s, signature: "0".repeat(64), factIndexes: [0] }))).toEqual(
      STALE,
    );
    expect(await asMember(f.recA, () => applyFindMore(id, { ...s, issuedAt: s.issuedAt - 1, factIndexes: [0] }))).toEqual(
      STALE,
    );
    expect(await factsOf(f.recA, id)).toHaveLength(0);
  });

  test("another member cannot apply, and a draft signed for another user is foreign", async () => {
    const id = await newMpc(f.recA);
    const s = await signed(id);
    expect(await asMember(f.recB, () => applyFindMore(id, { ...s, factIndexes: [0] }))).toEqual({
      ok: false,
      error: "You can only edit your own MPCs.",
    });
    expect(await asMember(f.admin, () => applyFindMore(id, { ...s, factIndexes: [0] }))).toEqual(STALE);
  });
});
