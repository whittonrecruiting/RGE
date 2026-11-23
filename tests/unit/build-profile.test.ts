import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { aiUsage, mpcDocuments, mpcs } from "@/db/schema";
import { runExtraction } from "@/lib/mpc/document-actions";
import { setTestGenerate } from "@/lib/ai/models";
import { AI_LIMITS, USER_HOURLY_LIMIT_ERROR } from "@/lib/ai/usage";
import { buildProfile } from "@/lib/mpc/build-profile-action";
import { listDocuments } from "@/lib/mpc/document-queries";
import { getMpc, listMpcs } from "@/lib/mpc/queries";
import { setTestFileStore } from "@/lib/storage";
import type { Member } from "@/lib/auth";
import { asOwner, createTestDb, seedAgencies, type TestDb } from "../helpers/test-db";
import { asMember, membersOf, type MemberFixtures } from "../helpers/as-member";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: TestDb;
let close: (() => Promise<void>) | undefined;
let f: MemberFixtures;
let g: MemberFixtures;
const stored: string[] = [];

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  close = t.close;
  const [a, b] = await seedAgencies(db, 2);
  f = membersOf(a);
  g = membersOf(b);
  stored.length = 0;
  process.env.RGE_DRAFT_SECRET = "test-secret-for-draft-signing";
  setTestFileStore(async (name) => {
    stored.push(name);
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

type Source = { file?: File; paste?: string; kind: string };
function form(sources: Source[]) {
  const fd = new FormData();
  for (const s of sources) {
    if (s.file) fd.append("file", s.file);
    else fd.append("paste", s.paste ?? "");
    fd.append("kind", s.kind);
  }
  return fd;
}
const txt = (name: string, content: string) => new File([content], name, { type: "text/plain" });
const buildAs = (m: Member, fd: FormData) => asMember(m, () => buildProfile(fd));
const allMpcs = () => asOwner(db, (tx) => tx.select({ id: mpcs.id, agencyId: mpcs.agencyId }).from(mpcs));

describe("buildProfile", () => {
  test("two files plus one paste create one draft with three documents", async () => {
    const r = await buildAs(
      f.recA,
      form([
        { file: txt("resume.txt", "Eight years litigating commercial cases."), kind: "resume" },
        { file: txt("call.md", "Talked about Denver."), kind: "transcript" },
        { paste: "Wants a hybrid role.", kind: "notes" },
      ]),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.documentErrors).toEqual([]);
    expect(await allMpcs()).toHaveLength(1);
    const mpc = await asMember(f.recA, () => getMpc(f.recA, r.mpcId));
    expect(mpc).toMatchObject({ status: "draft", ownerUserId: f.recA.userId, headlineRole: null, location: null });
    const docs = await asMember(f.recA, () => listDocuments(f.recA, r.mpcId));
    expect(docs.map((d) => [d.kind, d.filename]).sort()).toEqual(
      [
        ["notes", "Pasted notes"],
        ["resume", "resume.txt"],
        ["transcript", "call.md"],
      ].sort(),
    );
    expect(stored).toHaveLength(2);
  });

  test("an unsupported file is listed in documentErrors while the rest are saved", async () => {
    const r = await buildAs(
      f.recA,
      form([
        { file: txt("photo.png", "not a document"), kind: "resume" },
        { file: txt("resume.txt", "Eight years litigating."), kind: "resume" },
        { paste: "   ", kind: "notes" },
        { paste: "Prefers in-house.", kind: "bogus" },
      ]),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.documentErrors).toEqual([
      { name: "photo.png", error: "This file type is not supported. Use PDF, Word or text." },
      { name: "Pasted text 2", error: "Choose resume, notes or transcript." },
    ]);
    const docs = await asMember(f.recA, () => listDocuments(f.recA, r.mpcId));
    expect(docs.map((d) => d.filename)).toEqual(["resume.txt"]);
    expect(stored).toEqual(["resume.txt"]);
  });

  test("nothing valid returns the error and creates no MPC", async () => {
    const NOTHING = { ok: false, error: "Add at least one resume, notes or transcript." };
    expect(await buildAs(f.recA, new FormData())).toEqual(NOTHING);
    expect(await buildAs(f.recA, form([{ paste: "  ", kind: "notes" }]))).toEqual(NOTHING);
    expect(await buildAs(f.recA, form([{ file: txt("x.png", "nope"), kind: "resume" }]))).toEqual(NOTHING);
    expect(await allMpcs()).toHaveLength(0);
    expect(stored).toHaveLength(0);
  });

  test("a failed file upload is reported for that file and the rest are kept", async () => {
    setTestFileStore(async (name) => {
      if (name === "bad.txt") throw new Error("File storage is not set up.");
      stored.push(name);
      return { url: `https://blob.test/${name}` };
    });
    const r = await buildAs(
      f.recA,
      form([
        { file: txt("bad.txt", "Some text."), kind: "resume" },
        { paste: "Notes from the call.", kind: "notes" },
      ]),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.documentErrors).toEqual([{ name: "bad.txt", error: "File storage is not set up." }]);
    const docs = await asMember(f.recA, () => listDocuments(f.recA, r.mpcId));
    expect(docs.map((d) => d.filename)).toEqual(["Pasted notes"]);
  });

  test("the files together must fit in one upload", async () => {
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "a.txt", { type: "text/plain" });
    const big2 = new File([new Uint8Array(6 * 1024 * 1024)], "b.txt", { type: "text/plain" });
    const r = await buildAs(f.recA, form([{ file: big, kind: "resume" }, { file: big2, kind: "resume" }]));
    expect(r).toEqual({
      ok: false,
      error: "These files add up to more than 10 MB. Build the profile from fewer files, then add the rest on its page.",
    });
    expect(await allMpcs()).toHaveLength(0);
  });

  test("a recruiter builds only into their own agency (RLS)", async () => {
    const r = await buildAs(g.recA, form([{ paste: "Agency two notes.", kind: "notes" }]));
    if (!r.ok) throw new Error(r.error);
    const rows = await allMpcs();
    expect(rows).toEqual([{ id: r.mpcId, agencyId: g.agency.id }]);
    const [doc] = await asOwner(db, (tx) => tx.select().from(mpcDocuments).where(eq(mpcDocuments.mpcId, r.mpcId)));
    expect(doc.agencyId).toBe(g.agency.id);
    // Agency one cannot see the draft or its documents.
    expect(await asMember(f.owner, () => getMpc(f.owner, r.mpcId))).toBeNull();
    expect(await asMember(f.owner, () => listDocuments(f.owner, r.mpcId))).toEqual([]);
    expect(await asMember(f.owner, () => listMpcs(f.owner, { owner: "all" }))).toEqual([]);
  });

  test("when extraction fails or is rate limited after building, the draft and documents stay saved", async () => {
    const r = await buildAs(f.recA, form([{ paste: "Led discovery on a large commercial matter.", kind: "notes" }]));
    if (!r.ok) throw new Error(r.error);

    setTestGenerate((async () => {
      throw new Error("model down");
    }) as never);
    expect(await asMember(f.recA, () => runExtraction(r.mpcId))).toEqual({
      ok: false,
      error: "The extraction did not finish. Try again.",
    });

    await asOwner(db, (tx) =>
      tx.insert(aiUsage).values(
        Array.from({ length: AI_LIMITS.perUserPerHour }, () => ({
          agencyId: f.agency.id,
          userId: f.recA.userId,
          purpose: "extraction" as const,
          model: "seed",
          createdAt: sql`now() - make_interval(mins => 5)`,
        })),
      ),
    );
    expect(await asMember(f.recA, () => runExtraction(r.mpcId))).toEqual({ ok: false, error: USER_HOURLY_LIMIT_ERROR });

    expect((await asMember(f.recA, () => getMpc(f.recA, r.mpcId)))?.status).toBe("draft");
    expect(await asMember(f.recA, () => listDocuments(f.recA, r.mpcId))).toHaveLength(1);
  });
});
