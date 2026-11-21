import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { aiUsage } from "@/db/schema";
import { createMpc } from "@/lib/mpc/actions";
import { addDocument, runExtraction } from "@/lib/mpc/document-actions";
import { runFindMore } from "@/lib/mpc/find-more-action";
import { MODELS, setTestGenerate } from "@/lib/ai/models";
import { AI_LIMITS, AGENCY_DAILY_LIMIT_ERROR, USER_HOURLY_LIMIT_ERROR } from "@/lib/ai/usage";
import type { Member } from "@/lib/auth";
import { asOwner, createTestDb, type TestDb } from "../helpers/test-db";
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
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

async function newMpcWithNotes(m: Member) {
  const r = await asMember(m, () => createMpc({ headlineRole: "Senior Litigation Associate", location: "Phoenix, AZ" }));
  if (!r.ok) throw new Error(r.error);
  const fd = new FormData();
  fd.set("kind", "notes");
  fd.set("pastedText", "Candidate wants Denver and led discovery on a large matter.");
  await asMember(m, () => addDocument(r.id, fd));
  return r.id;
}

const usageRows = () => asOwner(db, (tx) => tx.select().from(aiUsage));

/** Inserts n usage rows for a member, created minutesAgo minutes ago. */
async function seedUsage(m: Member, n: number, minutesAgo: number) {
  await asOwner(db, (tx) =>
    tx.insert(aiUsage).values(
      Array.from({ length: n }, () => ({
        agencyId: m.agencyId,
        userId: m.userId,
        purpose: "extraction" as const,
        model: "seed",
        createdAt: sql`now() - make_interval(mins => ${minutesAgo})`,
      })),
    ),
  );
}

describe("AI usage metering", () => {
  test("a successful extraction records one row with the model's usage numbers", async () => {
    const id = await newMpcWithNotes(f.recA);
    setTestGenerate(fakeGenerate({ facts: [] }, { inputTokens: 1200, outputTokens: 340, webSearches: 0 }));
    expect((await asMember(f.recA, () => runExtraction(id))).ok).toBe(true);
    expect(await usageRows()).toEqual([
      expect.objectContaining({
        agencyId: f.agency.id,
        userId: f.recA.userId,
        purpose: "extraction",
        model: MODELS.extract,
        inputTokens: 1200,
        outputTokens: 340,
        webSearches: 0,
      }),
    ]);
  });

  test("a failed call is recorded too, with zeros when usage is unavailable", async () => {
    const id = await newMpcWithNotes(f.recA);
    vi.spyOn(console, "error").mockImplementation(() => {});
    setTestGenerate((async () => {
      throw new Error("boom");
    }) as never);
    expect((await asMember(f.recA, () => runExtraction(id))).ok).toBe(false);
    setTestGenerate(fakeGenerate({ facts: [] }));
    expect((await asMember(f.recA, () => runFindMore(id, ""))).ok).toBe(true);
    const rows = await usageRows();
    expect(rows.map((r) => [r.purpose, r.inputTokens, r.outputTokens, r.webSearches]).sort()).toEqual([
      ["extraction", 0, 0, 0],
      ["find_more", 0, 0, 0],
    ]);
  });

  test("Find more records web searches", async () => {
    const id = await newMpcWithNotes(f.recA);
    setTestGenerate(fakeGenerate({ facts: [] }, { inputTokens: 10, outputTokens: 5, webSearches: 3 }));
    await asMember(f.recA, () => runFindMore(id, ""));
    expect(await usageRows()).toEqual([expect.objectContaining({ purpose: "find_more", webSearches: 3, inputTokens: 10 })]);
  });

  test("nothing is recorded when the call never reaches the model", async () => {
    const id = await newMpcWithNotes(f.recA);
    setTestGenerate(fakeGenerate({ facts: [] }));
    await asMember(f.recB, () => runExtraction(id)); // not their MPC
    await asMember(f.recA, () => runFindMore(id, "x".repeat(5000))); // hints too long
    expect(await usageRows()).toHaveLength(0);
  });
});

describe("AI rate limits", () => {
  test("limits live in one place", () => {
    expect(AI_LIMITS).toEqual({ perUserPerHour: 30, perAgencyPerDay: 300 });
  });

  test("a user at 30 calls in the last hour is refused before the model is called", async () => {
    const id = await newMpcWithNotes(f.recA);
    await seedUsage(f.recA, AI_LIMITS.perUserPerHour, 10);
    const gen = fakeGenerate({ facts: [] });
    setTestGenerate(gen);
    expect(await asMember(f.recA, () => runExtraction(id))).toEqual({ ok: false, error: USER_HOURLY_LIMIT_ERROR });
    expect(await asMember(f.recA, () => runFindMore(id, ""))).toEqual({ ok: false, error: USER_HOURLY_LIMIT_ERROR });
    expect(gen.calls).toHaveLength(0);
    expect(await usageRows()).toHaveLength(AI_LIMITS.perUserPerHour);
    // A teammate is not limited by recA's hour.
    const other = await newMpcWithNotes(f.recB);
    expect((await asMember(f.recB, () => runExtraction(other))).ok).toBe(true);
  });

  test("calls older than an hour do not count toward the user limit", async () => {
    const id = await newMpcWithNotes(f.recA);
    await seedUsage(f.recA, AI_LIMITS.perUserPerHour, 61);
    await seedUsage(f.recA, AI_LIMITS.perUserPerHour - 1, 5);
    setTestGenerate(fakeGenerate({ facts: [] }));
    expect((await asMember(f.recA, () => runExtraction(id))).ok).toBe(true);
    expect(await asMember(f.recA, () => runExtraction(id))).toEqual({ ok: false, error: USER_HOURLY_LIMIT_ERROR });
  });

  test("an agency at 300 calls in the last 24 hours is refused; older calls do not count", async () => {
    const id = await newMpcWithNotes(f.recA);
    // Spread over teammates and older than an hour, so no single user limit applies.
    await seedUsage(f.owner, 150, 120);
    await seedUsage(f.admin, 149, 23 * 60);
    await seedUsage(f.recB, 50, 25 * 60);
    setTestGenerate(fakeGenerate({ facts: [] }));
    expect((await asMember(f.recA, () => runExtraction(id))).ok).toBe(true);
    expect(await asMember(f.recA, () => runExtraction(id))).toEqual({ ok: false, error: AGENCY_DAILY_LIMIT_ERROR });
    expect(USER_HOURLY_LIMIT_ERROR).toBe("You've hit the hourly limit for AI lookups. Try again later.");
    expect(AGENCY_DAILY_LIMIT_ERROR).toBe("Your agency has hit today's limit for AI lookups. Try again tomorrow.");
  });
});
