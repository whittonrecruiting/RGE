import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMpc } from "@/lib/mpc/actions";
import { listFacts } from "@/lib/mpc/document-queries";
import { listMpcs } from "@/lib/mpc/queries";
import {
  addManualFact,
  confirmFact,
  deleteFact,
  setCredentials,
  setRestrictions,
  updateFact,
} from "@/lib/mpc/fact-actions";
import { recordConsent } from "@/lib/mpc/consent-actions";
import { listConsents, listCredentials, listRestrictions } from "@/lib/mpc/fact-queries";
import { setTestFileStore } from "@/lib/storage";
import type { Member } from "@/lib/auth";
import { createTestDb, getFact, seedFact, type TestDb } from "../helpers/test-db";
import { asMember, seedMembers, type MemberFixtures } from "../helpers/as-member";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: TestDb;
let close: (() => Promise<void>) | undefined;
let f: MemberFixtures;
let mpcId: string;
const stored: { name: string; type: string }[] = [];
const EM = String.fromCharCode(0x2014);

beforeEach(async () => {
  const t = await createTestDb();
  db = t.db;
  close = t.close;
  f = await seedMembers(db);
  const r = await asMember(f.recA, () =>
    createMpc({ headlineRole: "Senior Litigation Associate", location: "Phoenix, AZ", yearsExperience: 8 }),
  );
  if (!r.ok) throw new Error(r.error);
  mpcId = r.id;
  stored.length = 0;
  setTestFileStore(async (name, _b, type) => {
    stored.push({ name, type });
    return { url: `https://blob.test/${name}` };
  });
});
afterEach(async () => {
  setTestFileStore(undefined);
  await close?.();
  close = undefined;
});

const fact = (status: "usable" | "interview_only" | "confirmed", extra = {}) =>
  seedFact(db, { agencyId: f.agency.id, mpcId, status, ...extra });
const confirmFactAs = (m: Member, id: string) => asMember(m, () => confirmFact(id));
const factsOf = (m: Member) => asMember(m, () => listFacts(m, mpcId));

describe("confirmFact", () => {
  test("confirming an interview-only fact makes it confirmed by the caller", async () => {
    const x = await fact("interview_only");
    expect((await confirmFactAs(f.recA, x.id)).ok).toBe(true);
    const after = await getFact(db, x.id);
    expect(after.status).toBe("confirmed");
    expect(after.confirmedBy).toBe(f.recA.userId);
    expect(after.confirmedAt).toBeInstanceOf(Date);
  });
  test("teammate cannot confirm facts on my MPC", async () => {
    const x = await fact("interview_only");
    expect((await confirmFactAs(f.recB, x.id)).ok).toBe(false);
    expect((await getFact(db, x.id)).status).toBe("interview_only");
  });
  test("an admin can confirm", async () => {
    const x = await fact("interview_only");
    expect((await confirmFactAs(f.admin, x.id)).ok).toBe(true);
  });
  test("confirming a usable fact is a no-op success", async () => {
    const x = await fact("usable");
    expect((await confirmFactAs(f.recA, x.id)).ok).toBe(true);
    const after = await getFact(db, x.id);
    expect(after.status).toBe("usable");
    expect(after.confirmedBy).toBeNull();
  });
  test("unknown or malformed ids fail", async () => {
    expect((await confirmFactAs(f.recA, "nope")).ok).toBe(false);
    expect((await confirmFactAs(f.recA, "00000000-0000-4000-8000-000000000000")).ok).toBe(false);
  });
});

describe("updateFact", () => {
  const QUOTE = "Tried twelve jury trials to verdict in state court";
  for (const sourceKind of ["resume", "notes", "transcript", "web"] as const) {
    for (const status of ["usable", "confirmed"] as const) {
      test(`editing a ${status} ${sourceKind} fact makes it a confirmed manual fact edited by the caller`, async () => {
        const x = await fact(status, { sourceKind, sourceRef: sourceKind === "web" ? "https://example.test/a" : "cv.pdf", sourceQuote: QUOTE });
        const r = await asMember(f.recA, () => updateFact(x.id, "  Tried 12 jury trials  "));
        expect(r.ok).toBe(true);
        const after = await getFact(db, x.id);
        expect(after).toMatchObject({
          text: "Tried 12 jury trials",
          sourceKind: "manual",
          status: "confirmed",
          sourceQuote: null,
          sourceRef: null,
          editedBy: f.recA.userId,
          confirmedBy: f.recA.userId,
        });
        expect(after.editedAt).toBeInstanceOf(Date);
      });
    }
  }
  test("editing a manual fact keeps it manual and confirmed and records the edit", async () => {
    await asMember(f.recA, () => addManualFact(mpcId, "Speaks Spanish"));
    const [row] = await factsOf(f.recA);
    expect(row.editedAt).toBeNull();
    await asMember(f.admin, () => updateFact(row.id, "Speaks Spanish and Portuguese"));
    const after = await getFact(db, row.id);
    expect(after).toMatchObject({ text: "Speaks Spanish and Portuguese", sourceKind: "manual", status: "confirmed", editedBy: f.admin.userId });
    expect(after.editedAt).toBeInstanceOf(Date);
    expect((await factsOf(f.recA))[0].editedAt).toBeInstanceOf(Date);
  });
  test("an edited interview-only fact stays interview-only with its source and records the edit", async () => {
    const x = await fact("interview_only", { sourceKind: "transcript", sourceRef: "call.txt", sourceQuote: QUOTE });
    await asMember(f.recA, () => updateFact(x.id, "Prefers Denver"));
    const after = await getFact(db, x.id);
    expect(after).toMatchObject({
      text: "Prefers Denver",
      status: "interview_only",
      sourceKind: "transcript",
      sourceRef: "call.txt",
      sourceQuote: QUOTE,
      editedBy: f.recA.userId,
      confirmedBy: null,
    });
    expect(after.editedAt).toBeInstanceOf(Date);
  });
  test("rejects empty, long and em dash text", async () => {
    const x = await fact("usable");
    expect((await asMember(f.recA, () => updateFact(x.id, "   "))).ok).toBe(false);
    expect((await asMember(f.recA, () => updateFact(x.id, "a".repeat(301)))).ok).toBe(false);
    const r = await asMember(f.recA, () => updateFact(x.id, `Great ${EM} truly`));
    expect(r).toEqual({ ok: false, error: "Remove em dashes from this fact." });
  });
  test("teammate cannot edit", async () => {
    const x = await fact("usable");
    expect((await asMember(f.recB, () => updateFact(x.id, "Changed"))).ok).toBe(false);
  });
});

describe("addManualFact and deleteFact", () => {
  test("a manual fact is confirmed, source manual", async () => {
    const r = await asMember(f.recA, () => addManualFact(mpcId, " Speaks Spanish "));
    expect(r.ok).toBe(true);
    const [row] = await factsOf(f.recA);
    expect(row).toMatchObject({ text: "Speaks Spanish", status: "confirmed", sourceKind: "manual" });
  });
  test("manual fact validation and permission", async () => {
    expect((await asMember(f.recA, () => addManualFact(mpcId, ""))).ok).toBe(false);
    expect((await asMember(f.recA, () => addManualFact(mpcId, `x ${EM} y`))).ok).toBe(false);
    expect((await asMember(f.recB, () => addManualFact(mpcId, "Fine"))).ok).toBe(false);
  });
  test("delete removes the fact; a teammate cannot", async () => {
    const x = await fact("usable");
    expect((await asMember(f.recB, () => deleteFact(x.id))).ok).toBe(false);
    expect(await getFact(db, x.id)).toBeDefined();
    expect((await asMember(f.recA, () => deleteFact(x.id))).ok).toBe(true);
    expect(await getFact(db, x.id)).toBeUndefined();
  });
});

describe("restrictions and credentials", () => {
  test("setRestrictions replaces the whole list", async () => {
    await asMember(f.recA, () =>
      setRestrictions(mpcId, [
        { kind: "never_say", value: "Left for health reasons" },
        { kind: "excluded_company", value: "Acme LLP" },
      ]),
    );
    expect(await asMember(f.recA, () => listRestrictions(f.recA, mpcId))).toHaveLength(2);
    const r = await asMember(f.recA, () => setRestrictions(mpcId, [{ kind: "confidential", value: "Current employer" }]));
    expect(r.ok).toBe(true);
    const rows = await asMember(f.recA, () => listRestrictions(f.recA, mpcId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "confidential", value: "Current employer" });
  });
  test("restriction validation leaves the list untouched", async () => {
    await asMember(f.recA, () => setRestrictions(mpcId, [{ kind: "never_say", value: "keep me" }]));
    expect((await asMember(f.recA, () => setRestrictions(mpcId, [{ kind: "never_say", value: "  " }]))).ok).toBe(false);
    expect((await asMember(f.recA, () => setRestrictions(mpcId, [{ kind: "never_say", value: "a".repeat(201) }]))).ok).toBe(false);
    expect((await asMember(f.recA, () => setRestrictions(mpcId, [{ kind: "bogus" as never, value: "x" }]))).ok).toBe(false);
    expect(await asMember(f.recA, () => listRestrictions(f.recA, mpcId))).toHaveLength(1);
  });
  test("teammate cannot set restrictions", async () => {
    expect((await asMember(f.recB, () => setRestrictions(mpcId, []))).ok).toBe(false);
  });
  test("setCredentials replaces the list and validates", async () => {
    const r = await asMember(f.recA, () =>
      setCredentials(mpcId, [
        { kind: "Bar admission", region: "Arizona", verified: true },
        { kind: "Bar admission", region: "California", verified: false },
      ]),
    );
    expect(r.ok).toBe(true);
    expect(await asMember(f.recA, () => listCredentials(f.recA, mpcId))).toHaveLength(2);
    expect((await asMember(f.recA, () => setCredentials(mpcId, [{ kind: "", region: "AZ", verified: false }]))).ok).toBe(false);
    expect((await asMember(f.recA, () => setCredentials(mpcId, [{ kind: "Bar", region: "", verified: false }]))).ok).toBe(false);
    expect(await asMember(f.recA, () => listCredentials(f.recA, mpcId))).toHaveLength(2);
    expect((await asMember(f.recB, () => setCredentials(mpcId, []))).ok).toBe(false);
  });
});

describe("recordConsent", () => {
  test("consent recorded clears the warning", async () => {
    expect((await asMember(f.recA, () => listMpcs(f.recA, { owner: "me" })))[0].consentOnFile).toBe(false);
    const r = await asMember(f.recA, () => recordConsent(mpcId, { givenOn: "2026-11-20", method: "verbal" }));
    expect(r.ok).toBe(true);
    expect((await asMember(f.recA, () => listMpcs(f.recA, { owner: "me" })))[0].consentOnFile).toBe(true);
  });
  test("history is kept and the latest is first", async () => {
    await asMember(f.recA, () => recordConsent(mpcId, { givenOn: "2026-11-01", method: "verbal" }));
    await asMember(f.recA, () => recordConsent(mpcId, { givenOn: "2026-11-20", method: "email" }));
    const rows = await asMember(f.recA, () => listConsents(f.recA, mpcId));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ givenOn: "2026-11-20", method: "email", recordedBy: f.recA.userId, hasProof: false });
  });
  test("future dates, bad dates and missing method are rejected", async () => {
    const tomorrow = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    expect(await asMember(f.recA, () => recordConsent(mpcId, { givenOn: tomorrow, method: "verbal" }))).toEqual({
      ok: false,
      error: "Consent date cannot be in the future.",
    });
    expect((await asMember(f.recA, () => recordConsent(mpcId, { givenOn: "not-a-date", method: "verbal" }))).ok).toBe(false);
    expect((await asMember(f.recA, () => recordConsent(mpcId, { givenOn: "2026-11-20", method: "" as never }))).ok).toBe(false);
  });
  test("teammate cannot record consent", async () => {
    expect((await asMember(f.recB, () => recordConsent(mpcId, { givenOn: "2026-11-20", method: "verbal" }))).ok).toBe(false);
  });
  test("a proof file is stored and flagged; bad types and sizes are rejected", async () => {
    const pdf = new File(["%PDF-1.4"], "consent.pdf", { type: "application/pdf" });
    const r = await asMember(f.recA, () => recordConsent(mpcId, { givenOn: "2026-11-20", method: "signed_form", proofFile: pdf }));
    expect(r.ok).toBe(true);
    expect(stored).toHaveLength(1);
    const [row] = await asMember(f.recA, () => listConsents(f.recA, mpcId));
    expect(row.hasProof).toBe(true);
    const exe = new File(["MZ"], "x.exe", { type: "application/octet-stream" });
    expect((await asMember(f.recA, () => recordConsent(mpcId, { givenOn: "2026-11-20", method: "verbal", proofFile: exe }))).ok).toBe(false);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    expect((await asMember(f.recA, () => recordConsent(mpcId, { givenOn: "2026-11-20", method: "verbal", proofFile: big }))).ok).toBe(false);
    expect(await asMember(f.recA, () => listConsents(f.recA, mpcId))).toHaveLength(1);
  });
  test("proof type comes from extension and bytes, not the client type", async () => {
    const rec = (file: File) => asMember(f.recA, () => recordConsent(mpcId, { givenOn: "2026-11-20", method: "verbal", proofFile: file }));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
    expect((await rec(new File([png], "x.exe", { type: "image/png" }))).ok).toBe(false);
    expect((await rec(new File(["%PDF-1.4"], "x.png", { type: "image/png" }))).ok).toBe(false);
    expect((await rec(new File([new Uint8Array([65, 0, 66])], "x.txt", { type: "text/plain" }))).ok).toBe(false);
    expect((await rec(new File([new Uint8Array([0xff, 0xfe, 0xfd])], "x.txt", { type: "text/plain" }))).ok).toBe(false);
    expect(stored).toHaveLength(0);
    expect((await rec(new File(["%PDF-1.7"], "a.pdf", { type: "text/html" }))).ok).toBe(true);
    expect((await rec(new File([png], "a.png", { type: "" }))).ok).toBe(true);
    expect((await rec(new File([jpg], "a.JPG", { type: "application/octet-stream" }))).ok).toBe(true);
    expect((await rec(new File(["Consent given by phone."], "a.txt", { type: "" }))).ok).toBe(true);
    expect(stored.map((s) => s.type)).toEqual(["application/pdf", "image/png", "image/jpeg", "text/plain"]);
  });
});
