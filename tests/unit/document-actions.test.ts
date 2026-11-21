import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mpcDocuments, mpcRestrictions, mpcs } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { createMpc } from "@/lib/mpc/actions";
import { addDocument, applyExtraction, runExtraction } from "@/lib/mpc/document-actions";
import { listDocuments, listFacts } from "@/lib/mpc/document-queries";
import { getMpc } from "@/lib/mpc/queries";
import { signDraft } from "@/lib/mpc/draft-signing";
import type { ProfileDraft } from "@/lib/ai/extract-profile";
import { setTestFileStore } from "@/lib/storage";
import { setTestGenerate } from "@/lib/ai/models";
import type { Member } from "@/lib/auth";
import { createTestDb, type TestDb } from "../helpers/test-db";
import { asMember, seedMembers, type MemberFixtures } from "../helpers/as-member";
import { fakeGenerate } from "../helpers/fake-ai";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: TestDb;
let close: (() => Promise<void>) | undefined;
let f: MemberFixtures;
const stored: { name: string; type: string; size: number }[] = [];

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  close = t.close;
  f = await seedMembers(db);
  stored.length = 0;
  process.env.RGE_DRAFT_SECRET = "test-secret-for-draft-signing";
  setTestFileStore(async (name, bytes, contentType) => {
    stored.push({ name, type: contentType, size: bytes.length });
    return { url: `https://blob.test/${stored.length}/${name}` };
  });
});
afterEach(async () => {
  delete process.env.RGE_DRAFT_SECRET;
  setTestFileStore(undefined);
  setTestGenerate(undefined);
  await close?.();
  close = undefined;
});

const base = { headlineRole: "Senior Litigation Associate", location: "Phoenix, AZ", yearsExperience: 8 };
async function newMpc(m: Member) {
  const r = await asMember(m, () => createMpc(base));
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

function pasted(kind: string, text: string, name?: string) {
  const fd = new FormData();
  fd.set("kind", kind);
  fd.set("pastedText", text);
  if (name) fd.set("name", name);
  return fd;
}
function upload(kind: string, filename: string, content: string, type = "text/plain") {
  const fd = new FormData();
  fd.set("kind", kind);
  fd.set("file", new File([content], filename, { type }));
  return fd;
}
const docsOf = (m: Member, id: string) => asMember(m, () => listDocuments(m, id));
const factsOf = (m: Member, id: string) => asMember(m, () => listFacts(m, id));

describe("addDocument", () => {
  test("pasted text is stored as text only, with no blob", async () => {
    const id = await newMpc(f.recA);
    const r = await asMember(f.recA, () => addDocument(id, pasted("notes", "Candidate wants Denver.")));
    expect(r.ok).toBe(true);
    const docs = await docsOf(f.recA, id);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ kind: "notes", filename: "Pasted notes", text: "Candidate wants Denver.", hasFile: false });
    expect(stored).toHaveLength(0);
  });

  test("an uploaded text file is kept in storage and its text is saved", async () => {
    const id = await newMpc(f.recA);
    const r = await asMember(f.recA, () => addDocument(id, upload("resume", "resume.txt", "Eight years litigating.")));
    expect(r.ok).toBe(true);
    expect(stored).toHaveLength(1);
    const [row] = await withAgency(f.agency.id, (tx) => tx.select().from(mpcDocuments).where(eq(mpcDocuments.mpcId, id)));
    expect(row.blobUrl).toMatch(/^https:\/\/blob\.test\//);
    expect(row.text).toBe("Eight years litigating.");
    expect(row.createdBy).toBe(f.recA.userId);
  });

  test("a file with no readable text is refused with the paste message and nothing is stored", async () => {
    const id = await newMpc(f.recA);
    const r = await asMember(f.recA, () => addDocument(id, upload("resume", "scan.txt", "   ")));
    expect(r.ok).toBe(false);
    expect(stored).toHaveLength(0);
    expect(await docsOf(f.recA, id)).toHaveLength(0);
  });

  test("rejects bad kinds, empty paste and missing input", async () => {
    const id = await newMpc(f.recA);
    expect(await asMember(f.recA, () => addDocument(id, pasted("bogus", "x")))).toEqual({
      ok: false,
      error: "Choose resume, notes or transcript.",
    });
    expect(await asMember(f.recA, () => addDocument(id, pasted("notes", "   ")))).toEqual({
      ok: false,
      error: "Paste some text or choose a file.",
    });
    expect(await asMember(f.recA, () => addDocument(id, new FormData()))).toEqual({
      ok: false,
      error: "Choose resume, notes or transcript.",
    });
  });

  test("a recruiter cannot add to a teammate MPC; owner and admin can", async () => {
    const id = await newMpc(f.recA);
    expect(await asMember(f.recB, () => addDocument(id, pasted("notes", "x")))).toEqual({
      ok: false,
      error: "You can only edit your own MPCs.",
    });
    expect((await asMember(f.admin, () => addDocument(id, pasted("notes", "y")))).ok).toBe(true);
    expect((await asMember(f.owner, () => addDocument(id, pasted("notes", "z")))).ok).toBe(true);
  });

  test("unknown or malformed MPC id", async () => {
    expect(await asMember(f.recA, () => addDocument("nope", pasted("notes", "x")))).toEqual({ ok: false, error: "MPC not found." });
  });
});

const draftOut = {
  fields: { yearsExperience: 9, specialtyTags: ["Commercial litigation"] },
  facts: [
    { text: "Led discovery on a large matter", sourceKind: "resume", sourceRef: "resume.txt", sourceQuote: "Led discovery on a $120M breach of contract matter" },
    { text: "Open to Denver", sourceKind: "notes", sourceRef: "Pasted notes", sourceQuote: "Candidate wants Denver." },
    { text: "Invented", sourceKind: "resume", sourceRef: "resume.txt", sourceQuote: "Never in the text" },
  ],
  restrictionsSuggested: [{ kind: "never_say", value: "the Acme merger" }],
};

async function seedDocs(id: string) {
  await asMember(f.recA, () => addDocument(id, upload("resume", "resume.txt", "Led discovery on a $120M breach of contract matter")));
  await asMember(f.recA, () => addDocument(id, pasted("notes", "Candidate wants Denver.")));
}

describe("runExtraction", () => {
  test("returns a verified draft and writes nothing", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    setTestGenerate(fakeGenerate(draftOut));
    const r = await asMember(f.recA, () => runExtraction(id));
    if (!r.ok) throw new Error(r.error);
    expect(r.draft.facts.map((x) => x.text)).toEqual(["Led discovery on a large matter", "Open to Denver"]);
    expect(r.draft.restrictionsSuggested).toHaveLength(1);
    expect(await factsOf(f.recA, id)).toHaveLength(0);
  });

  test("needs at least one document and checks permission", async () => {
    const id = await newMpc(f.recA);
    setTestGenerate(fakeGenerate(draftOut));
    expect(await asMember(f.recA, () => runExtraction(id))).toEqual({
      ok: false,
      error: "Add a resume, notes or a transcript first.",
    });
    await seedDocs(id);
    expect(await asMember(f.recB, () => runExtraction(id))).toEqual({
      ok: false,
      error: "You can only edit your own MPCs.",
    });
  });

  test("a model failure comes back as a plain error", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    setTestGenerate((async () => {
      throw new Error("boom");
    }) as never);
    const r = await asMember(f.recA, () => runExtraction(id));
    expect(r).toEqual({ ok: false, error: "The extraction did not finish. Try again." });
  });
});

describe("applyExtraction", () => {
  type Signed = { draft: ProfileDraft; issuedAt: number; signature: string };
  async function draftFor(id: string, m: Member = f.recA): Promise<Signed> {
    setTestGenerate(fakeGenerate(draftOut));
    const r = await asMember(m, () => runExtraction(id));
    if (!r.ok) throw new Error(r.error);
    return { draft: r.draft, issuedAt: r.issuedAt, signature: r.signature };
  }
  const accept = (s: Signed, over: Partial<Parameters<typeof applyExtraction>[1]> = {}) => ({
    ...s,
    fields: {},
    factIndexes: [] as number[],
    restrictionIndexes: [] as number[],
    ...over,
  });
  const STALE = { ok: false, error: "This review is out of date. Run the extraction again." };

  test("writes only accepted fields, facts and restrictions, with status by source kind", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    const s = await draftFor(id);
    const r = await asMember(f.recA, () =>
      applyExtraction(id, accept(s, { fields: { yearsExperience: 9 }, factIndexes: [0, 1] })),
    );
    expect(r).toEqual({ ok: true });
    const mpc = await asMember(f.recA, () => getMpc(f.recA, id));
    expect(mpc?.yearsExperience).toBe(9);
    expect(mpc?.specialtyTags).toEqual([]); // not accepted
    expect(mpc?.headlineRole).toBe(base.headlineRole);
    const facts = await factsOf(f.recA, id);
    expect(facts.map((x) => [x.text, x.status, x.sourceKind]).sort()).toEqual([
      ["Led discovery on a large matter", "usable", "resume"],
      ["Open to Denver", "interview_only", "notes"],
    ]);
    expect(await withAgency(f.agency.id, (tx) => tx.select().from(mpcRestrictions))).toHaveLength(0);
  });

  test("accepted restrictions are saved", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    const s = await draftFor(id);
    await asMember(f.recA, () => applyExtraction(id, accept(s, { restrictionIndexes: [0] })));
    const rows = await withAgency(f.agency.id, (tx) => tx.select().from(mpcRestrictions));
    expect(rows.map((x) => [x.kind, x.value])).toEqual([["never_say", "the Acme merger"]]);
  });

  test("a forged fact text with a valid tiny quote is rejected and nothing is written", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    const s = await draftFor(id);
    const forged = {
      ...s.draft,
      facts: [{ text: "Won a $50M verdict", sourceKind: "resume" as const, sourceRef: "resume.txt", sourceQuote: "a" }],
    };
    const r = await asMember(f.recA, () => applyExtraction(id, accept({ ...s, draft: forged }, { factIndexes: [0] })));
    expect(r).toEqual(STALE);
    expect(await factsOf(f.recA, id)).toHaveLength(0);
  });

  test("a quote under 20 characters is dropped even when it is in the document", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    setTestGenerate(
      fakeGenerate({
        facts: [{ text: "Tiny", sourceKind: "resume", sourceRef: "resume.txt", sourceQuote: "Led discovery" }],
      }),
    );
    const r = await asMember(f.recA, () => runExtraction(id));
    if (!r.ok) throw new Error(r.error);
    expect(r.draft.facts).toEqual([]);
  });

  test("altering any field, fact or restriction after signing is rejected", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    const s = await draftFor(id);
    const tampered: ProfileDraft[] = [
      { ...s.draft, fields: { ...s.draft.fields, yearsExperience: 30 } },
      { ...s.draft, facts: s.draft.facts.map((x, i) => (i === 0 ? { ...x, text: "Changed text" } : x)) },
      { ...s.draft, facts: [...s.draft.facts, { ...s.draft.facts[0], text: "Added" }] },
      { ...s.draft, restrictionsSuggested: [{ kind: "never_say", value: "something else" }] },
    ];
    for (const draft of tampered) {
      const r = await asMember(f.recA, () =>
        applyExtraction(id, accept({ ...s, draft }, { factIndexes: [0], restrictionIndexes: [0] })),
      );
      expect(r).toEqual(STALE);
    }
    expect(await factsOf(f.recA, id)).toHaveLength(0);
  });

  test("accepted fields must be the signed proposals; pay fields are never written", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    const s = await draftFor(id);
    expect(await asMember(f.recA, () => applyExtraction(id, accept(s, { fields: { yearsExperience: -4 } })))).toEqual(STALE);
    const r = await asMember(f.recA, () =>
      applyExtraction(id, accept(s, { fields: { payTarget: 500000, yearsExperience: 9 } as never })),
    );
    expect(r).toEqual(STALE);
    const [row] = await withAgency(f.agency.id, (tx) => tx.select().from(mpcs).where(eq(mpcs.id, id)));
    expect(row.payTarget).toBeNull();
    expect(row.yearsExperience).toBe(8);
  });

  test("a missing or wrong signature is rejected", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    const s = await draftFor(id);
    for (const signature of ["", "zz", "0".repeat(64), undefined as never]) {
      expect(
        await asMember(f.recA, () => applyExtraction(id, accept({ ...s, signature }, { factIndexes: [0] }))),
      ).toEqual(STALE);
    }
  });

  test("an expired draft is rejected", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    const s = await draftFor(id);
    const issuedAt = Date.now() - 25 * 60 * 60 * 1000;
    const signature = signDraft({ mpcId: id, userId: f.recA.userId, issuedAt, draft: s.draft });
    expect(
      await asMember(f.recA, () => applyExtraction(id, accept({ ...s, issuedAt, signature }, { factIndexes: [0] }))),
    ).toEqual(STALE);
    const fresh = Date.now() - 23 * 60 * 60 * 1000;
    const ok = signDraft({ mpcId: id, userId: f.recA.userId, issuedAt: fresh, draft: s.draft });
    const r = await asMember(f.recA, () =>
      applyExtraction(id, accept({ ...s, issuedAt: fresh, signature: ok }, { factIndexes: [0] })),
    );
    expect(r.ok).toBe(true);
  });

  test("a draft signed for another MPC or another user is rejected", async () => {
    const id = await newMpc(f.recA);
    const other = await newMpc(f.recA);
    await seedDocs(id);
    await seedDocs(other);
    const forOther = await draftFor(other);
    expect(await asMember(f.recA, () => applyExtraction(id, accept(forOther, { factIndexes: [0] })))).toEqual(STALE);
    // Admin may edit the MPC, but a draft run by recA is not valid for admin.
    const byRecA = await draftFor(id);
    expect(await asMember(f.admin, () => applyExtraction(id, accept(byRecA, { factIndexes: [0] })))).toEqual(STALE);
    expect(await factsOf(f.recA, id)).toHaveLength(0);
    // The admin's own run works.
    const byAdmin = await draftFor(id, f.admin);
    expect((await asMember(f.admin, () => applyExtraction(id, accept(byAdmin, { factIndexes: [0] })))).ok).toBe(true);
  });

  test("applying twice does not duplicate facts", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    const s = await draftFor(id);
    const accepted = accept(s, { factIndexes: [0, 1] });
    await asMember(f.recA, () => applyExtraction(id, accepted));
    await asMember(f.recA, () => applyExtraction(id, accepted));
    expect(await factsOf(f.recA, id)).toHaveLength(2);
  });

  test("permission: a teammate recruiter cannot apply", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    const s = await draftFor(id);
    expect(await asMember(f.recB, () => applyExtraction(id, accept(s, { factIndexes: [0] })))).toEqual({
      ok: false,
      error: "You can only edit your own MPCs.",
    });
  });

  test("without RGE_DRAFT_SECRET both actions refuse", async () => {
    const id = await newMpc(f.recA);
    await seedDocs(id);
    const s = await draftFor(id);
    delete process.env.RGE_DRAFT_SECRET;
    const msg = { ok: false, error: "Extraction is not configured yet." };
    expect(await asMember(f.recA, () => runExtraction(id))).toEqual(msg);
    expect(await asMember(f.recA, () => applyExtraction(id, accept(s, { factIndexes: [0] })))).toEqual(msg);
  });
});
