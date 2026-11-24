import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { companies, doNotContact, ledgerEvents, suppressions } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { setAuthReader } from "@/lib/auth";
import { parseCsv } from "@/lib/csv";
import { parseWallTime } from "@/lib/history-import/csv";
import { parseImport } from "@/lib/history-import/parsers";
import { applyImport, previewImport } from "@/lib/history-import/actions";
import { createTestDb, type TestDb } from "../helpers/test-db";
import { asMember, seedMembers, type MemberFixtures } from "../helpers/as-member";

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
  setAuthReader(undefined);
  await close?.();
  close = undefined;
});

const PHX = "America/Phoenix";

const form = (kind: string, text: string, name: string) => {
  const data = new FormData();
  data.set("kind", kind);
  data.set("file", new File([text], name, { type: "text/plain" }));
  return data;
};

const count = (table: typeof ledgerEvents | typeof suppressions | typeof doNotContact) =>
  withAgency(f.agency.id, async (tx) => (await tx.select().from(table)).length);

const SENDS = [
  "recipient,time,status,message_id,company,extra",
  "pat@example.com,2026-11-18 09:14,sent,m1,Example Co,x",
  "lee@example.org,2026-11-18 10:00,failed,m2,Other Co,x",
  "sam@example.net,2026-11-18 10:05,held,m3,Third Co,x",
  "kim@example.net,2026-11-19 08:00,,m4,Fourth Co,x",
].join("\n");

describe("csv helpers", () => {
  test("parseCsv handles quotes, commas, newlines in fields, CRLF and BOM", () => {
    const text = '﻿a,b\r\n"x, y","l1\nl2"\r\n"say ""hi""",z\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["x, y", "l1\nl2"],
      ['say "hi"', "z"],
    ]);
  });

  test('parseWallTime reads "2026-11-18 09:14" as 9:14 AM Phoenix (16:14Z)', () => {
    expect(parseWallTime("2026-11-18 09:14", PHX)?.toISOString()).toBe("2026-11-18T16:14:00.000Z");
    expect(parseWallTime("2026-11-18", PHX)?.toISOString()).toBe("2026-11-18T07:00:00.000Z");
    expect(parseWallTime("11/18/2026 9:14 AM", PHX)?.toISOString()).toBe("2026-11-18T16:14:00.000Z");
    expect(parseWallTime("11/18/2026 1:05 PM", PHX)?.toISOString()).toBe("2026-11-18T20:05:00.000Z");
    expect(parseWallTime("11/8/2026", PHX)?.toISOString()).toBe("2026-11-08T07:00:00.000Z");
    expect(parseWallTime("2026-11-18T09:14:00-05:00", PHX)?.toISOString()).toBe("2026-11-18T14:14:00.000Z");
    expect(parseWallTime("2026-11-18T09:14:00Z", PHX)?.toISOString()).toBe("2026-11-18T09:14:00.000Z");
    expect(parseWallTime("2026-11-18 09:14:30", PHX)?.toISOString()).toBe("2026-11-18T16:14:30.000Z");
    // A zone with daylight saving.
    expect(parseWallTime("2026-07-01 12:00", "America/New_York")?.toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(parseWallTime("2026-01-01 12:00", "America/New_York")?.toISOString()).toBe("2026-01-01T17:00:00.000Z");
  });

  test("parseWallTime rejects anything else", () => {
    for (const bad of ["", "tomorrow", "2026-13-40", "2026-02-30", "13/40/2026", "2026-11-18 25:00", "18 Nov 2026", "2026-02-30T10:00:00Z", "2026-04-31T08:00:00-07:00", "0026-01-01"]) {
      expect(parseWallTime(bad, PHX)).toBeNull();
    }
  });
});

describe("parseImport", () => {
  test("bad dates skip the row with a reason", () => {
    const text = ["recipient,time,status,message_id", "pat@example.com,not a date,sent,m1", "lee@example.org,2026-11-18,sent,m2"].join("\n");
    const parsed = parseImport("sends", "mpc-send-1.csv", text, PHX);
    expect(parsed.inputs).toHaveLength(1);
    expect(parsed.skipped).toEqual([{ line: 2, reason: "Date or time not recognized" }]);
    expect(parsed.rows).toBe(2);
  });

  test("send log imports sent rows only and skips failed and held", () => {
    const parsed = parseImport("sends", "mpc-send-1.csv", SENDS, PHX);
    expect(parsed.inputs.map((i) => [i.type, i.email, i.dedupeKey])).toEqual([
      ["sent", "pat@example.com", "import:sent:m1"],
      ["sent", "kim@example.net", "import:sent:m4"],
    ]);
    expect(parsed.inputs[0]).toMatchObject({ companyName: "Example Co", source: "import" });
    expect(parsed.skipped).toEqual([
      { line: 3, reason: "status failed not imported" },
      { line: 4, reason: "status held not imported" },
    ]);
  });

  test("a send row without a message id keys on the address and time", () => {
    const parsed = parseImport("sends", "a.csv", "recipient,time,status\nPat@Example.com,2026-11-18 09:14,sent", PHX);
    expect(parsed.inputs[0]!.dedupeKey).toBe("import:sent:pat@example.com:2026-11-18T16:14:00.000Z");
  });

  test("a missing column is reported once", () => {
    const parsed = parseImport("sends", "a.csv", "who,when\nx,y", PHX);
    expect(parsed.inputs).toHaveLength(0);
    expect(parsed.skipped).toHaveLength(1);
    expect(parsed.skipped[0]!.line).toBe(1);
  });

  test("follow-up log produces follow_up_sent", () => {
    const text = ["recipient,time,status,followup_message_id", "pat@example.com,2026-11-25 09:00,sent,f1", "lee@example.org,2026-11-25 09:05,sent,"].join("\n");
    const parsed = parseImport("followups", "mpc-followups.csv", text, PHX);
    expect(parsed.inputs.map((i) => [i.type, i.dedupeKey])).toEqual([
      ["follow_up_sent", "import:fu:f1"],
      ["follow_up_sent", "import:fu:lee@example.org:2026-11-25T16:05:00.000Z"],
    ]);
    expect(parsed.inputs.map((i) => i.gmailMessageId)).toEqual(["f1", null]);
  });

  test("suppression txt pulls every email on each line", () => {
    const text = "Pat <pat@Example.com>, lee@example.org; and sam@example.net\nno address here\nsolo@example.com\n";
    const parsed = parseImport("suppression", "unsubscribed.txt", text, PHX);
    expect(parsed.suppressions.map((s) => s.email)).toEqual(["pat@example.com", "lee@example.org", "sam@example.net", "solo@example.com"]);
    expect(parsed.suppressions.every((s) => s.reason === "opted_out")).toBe(true);
    expect(parsed.skipped).toEqual([{ line: 2, reason: "No email address found" }]);
  });

  test("suppression csv maps reasons containing bounce to bounced", () => {
    const text = ["Recipient,Reason", "pat@example.com,Hard bounce", "lee@example.org,unsubscribed", "nope,x"].join("\n");
    const parsed = parseImport("suppression", "s.csv", text, PHX);
    expect(parsed.suppressions).toEqual([
      { email: "pat@example.com", reason: "bounced" },
      { email: "lee@example.org", reason: "opted_out" },
    ]);
    expect(parsed.skipped).toHaveLength(1);
  });

  test("outcomes: signed types become agreement_signed, pitches become sent, others are skipped with a reason", () => {
    const text = [
      "date,firm,contact,type",
      "2026-11-10,Example Law LLP,pat@example.com,signed_fee_agreement",
      "2026-11-11,Sample Group,Pat Smith,signed_msa",
      "2026-11-12,Third Co,lee@example.org,mpc_pitch_sent",
      "2026-11-13,Third Co,Lee,mpc_pitch_sent",
      "2026-11-14,Third Co,lee@example.org,call_booked",
    ].join("\n");
    const parsed = parseImport("outcomes", "sales-outcomes.csv", text, PHX);
    expect(parsed.inputs.map((i) => [i.type, i.email ?? null, i.companyName ?? null])).toEqual([
      ["agreement_signed", "pat@example.com", "Example Law LLP"],
      ["agreement_signed", null, "Sample Group"],
      ["sent", "lee@example.org", "Third Co"],
    ]);
    expect(parsed.inputs.every((i) => i.dedupeKey.startsWith("import:outcome:"))).toBe(true);
    expect(parsed.skipped.map((s) => s.reason)).toEqual(["contact is not an email address", "type not imported"]);
  });

  test("outcome dedupe keys do not depend on line order", () => {
    const a = "date,firm,contact,type\n2026-11-10,A Co,a@example.com,signed_x\n2026-11-11,B Co,b@example.com,signed_y";
    const b = "date,firm,contact,type\n2026-11-11,B Co,b@example.com,signed_y\n2026-11-10,A Co,a@example.com,signed_x";
    const keys = (t: string) => parseImport("outcomes", "o.csv", t, PHX).inputs.map((i) => i.dedupeKey).sort();
    expect(keys(a)).toEqual(keys(b));
  });

  test("dnc kind reuses the do-not-contact reader", () => {
    const parsed = parseImport("dnc", "dnc.csv", "name,domains,aliases\nExample Law,example-law.example.com,\nNo Targets,,", PHX);
    expect(parsed.dnc).toHaveLength(1);
    expect(parsed.skipped).toHaveLength(1);
    expect(parsed.rows).toBe(2);
  });
});

describe("applyImport and previewImport", () => {
  test("re-importing the same send log inserts nothing", async () => {
    const first = await asMember(f.owner, () => applyImport(form("sends", SENDS, "mpc-send-1.csv")));
    expect(first).toMatchObject({ ok: true, summary: { rows: 4, newEvents: 2 } });
    const second = await asMember(f.owner, () => applyImport(form("sends", SENDS, "mpc-send-1.csv")));
    expect(second).toMatchObject({ ok: true, summary: { newEvents: 0 } });
    expect(await count(ledgerEvents)).toBe(2);
    const events = await withAgency(f.agency.id, (tx) => tx.select().from(ledgerEvents));
    expect(events.every((e) => e.source === "import" && e.userId === f.owner.userId)).toBe(true);
  });

  test("preview writes nothing and reports exact counts, including duplicates", async () => {
    const preview = await asMember(f.owner, () => previewImport(form("sends", SENDS, "a.csv")));
    expect(preview).toMatchObject({ ok: true, summary: { rows: 4, newEvents: 2 } });
    expect(await count(ledgerEvents)).toBe(0);
    expect(await withAgency(f.agency.id, async (tx) => (await tx.select().from(companies)).length)).toBe(0);

    await asMember(f.owner, () => applyImport(form("sends", SENDS, "a.csv")));
    const again = await asMember(f.owner, () => previewImport(form("sends", SENDS, "a.csv")));
    expect(again).toMatchObject({ ok: true, summary: { newEvents: 0 } });
    expect(await count(ledgerEvents)).toBe(2);
  });

  test("suppressions and do-not-contact rows are counted, written once and never duplicated", async () => {
    const txt = "pat@example.com lee@example.org\n";
    const prev = await asMember(f.admin, () => previewImport(form("suppression", txt, "s.txt")));
    expect(prev).toMatchObject({ ok: true, summary: { newSuppressions: 2 } });
    expect(await count(suppressions)).toBe(0);
    await asMember(f.admin, () => applyImport(form("suppression", txt, "s.txt")));
    const again = await asMember(f.admin, () => applyImport(form("suppression", txt, "s.txt")));
    expect(again).toMatchObject({ ok: true, summary: { newSuppressions: 0 } });
    expect(await count(suppressions)).toBe(2);
    const rows = await withAgency(f.agency.id, (tx) => tx.select().from(suppressions).where(eq(suppressions.email, "pat@example.com")));
    expect(rows[0]).toMatchObject({ reason: "opted_out", source: "import", createdBy: f.admin.userId });

    const dnc = "name,domains,aliases\nExample Law,example-law.example.com,Example Parent\n";
    const one = await asMember(f.owner, () => applyImport(form("dnc", dnc, "dnc.csv")));
    expect(one).toMatchObject({ ok: true, summary: { dncAdded: 1, dncMerged: 0 } });
    const two = await asMember(f.owner, () => applyImport(form("dnc", dnc, "dnc.csv")));
    expect(two).toMatchObject({ ok: true, summary: { dncAdded: 0, dncMerged: 1 } });
    expect(await count(doNotContact)).toBe(1);
  });

  test("outcomes: signed_fee_agreement marks the firm a client", async () => {
    const text = "date,firm,contact,type\n2026-11-10,Example Law LLP,pat@example.com,signed_fee_agreement\n2026-11-11,Third Co,x@example.org,call_booked\n";
    const result = await asMember(f.owner, () => applyImport(form("outcomes", text, "sales-outcomes.csv")));
    expect(result).toMatchObject({ ok: true, summary: { rows: 2, newEvents: 1 } });
    if (result.ok) expect(result.summary.skipped).toEqual([{ line: 3, reason: "type not imported" }]);
    const rows = await withAgency(f.agency.id, (tx) => tx.select().from(companies));
    expect(rows.find((c) => c.name === "Example Law LLP")?.isClient).toBe(true);
  });

  test("a recruiter cannot preview or apply", async () => {
    const p = await asMember(f.recA, () => previewImport(form("sends", SENDS, "a.csv")));
    const a = await asMember(f.recA, () => applyImport(form("sends", SENDS, "a.csv")));
    expect(p.ok).toBe(false);
    expect(a.ok).toBe(false);
    expect(await count(ledgerEvents)).toBe(0);
  });

  test("rejects a bad kind, a missing, empty, oversize or wrongly named file, and huge row counts", async () => {
    const run = (data: FormData) => asMember(f.owner, () => previewImport(data));
    expect(await run(form("nope", "x", "a.csv"))).toMatchObject({ ok: false });
    expect(await run(new FormData())).toMatchObject({ ok: false });
    expect(await run(form("sends", "", "a.csv"))).toMatchObject({ ok: false, error: "That file is empty." });
    expect(await run(form("sends", "x".repeat(5 * 1024 * 1024), "a.csv"))).toMatchObject({ ok: false });
    expect(await run(form("sends", SENDS, "a.pdf"))).toMatchObject({ ok: false });
    expect(await run(form("sends", SENDS, "a.txt"))).toMatchObject({ ok: false });
    const rows = ["recipient,time,status"];
    for (let i = 0; i < 20_001; i++) rows.push(`u${i}@example.com,2026-11-18,sent`);
    expect(await run(form("sends", rows.join("\n"), "big.csv"))).toEqual({
      ok: false,
      error: "This file is too large. Split it into smaller files.",
    });
  });
});
