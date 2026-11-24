import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { withAgency } from "@/db/with-agency";
import { parseCsv } from "@/lib/csv";
import { parseDncCsv } from "@/lib/dnc/csv";
import { addDncEntry, importDncCsv, removeDncEntry } from "@/lib/dnc/actions";
import { listDnc, upsertDncEntries } from "@/lib/dnc/queries";
import { doNotContactMatch } from "@/lib/ledger/checks";
import { setAuthReader } from "@/lib/auth";
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

const csvForm = (text: string, name = "list.csv", type = "text/csv") => {
  const form = new FormData();
  form.set("file", new File([text], name, { type }));
  return form;
};

describe("parseCsv", () => {
  test("handles quotes, embedded commas and newlines, CRLF and a BOM", () => {
    const text = '﻿name,note\r\n"Example, Inc.","two\nlines"\r\nPlain,"say ""hi"""\r\n';
    expect(parseCsv(text)).toEqual([
      ["name", "note"],
      ["Example, Inc.", "two\nlines"],
      ["Plain", 'say "hi"'],
    ]);
  });
});

describe("parseDncCsv", () => {
  test("reads lists, reports a row with no domain or alias, and rejects a bad domain", () => {
    const text = [
      "Name,Domains,Aliases,Note",
      'Example Law LLP,"example-law.example.com; www.Example-Law.example.org","Example Law Holdings|Example Sub",Do not call',
      "No Targets,,,",
      "Bad Domain Co,not a domain,,",
      "Alias Only,,Alias Only Parent,",
    ].join("\n");
    const { rows, errors } = parseDncCsv(text);
    expect(rows).toEqual([
      {
        name: "Example Law LLP",
        domains: ["example-law.example.com", "example-law.example.org"],
        aliases: ["Example Law Holdings", "Example Sub"],
        note: "Do not call",
      },
      { name: "Alias Only", domains: [], aliases: ["Alias Only Parent"], note: null },
    ]);
    expect(errors.map((e) => e.line)).toEqual([3, 4]);
    expect(errors[0]!.reason).toMatch(/domain or alias/);
    expect(errors[1]!.reason).toMatch(/not a domain/);
  });

  test("a file without a name header reports it on line 1", () => {
    const { rows, errors } = parseDncCsv("company,sites\nExample,example.com");
    expect(rows).toEqual([]);
    expect(errors[0]!.line).toBe(1);
  });
});

describe("addDncEntry and importDncCsv", () => {
  test("a CSV row matching an existing name merges instead of duplicating", async () => {
    const added = await asMember(f.owner, () =>
      addDncEntry({ name: "Sample Law", domains: ["sample-law.example.com"], aliases: ["Sample Parent"] }),
    );
    expect(added).toEqual({ ok: true });

    const csv = [
      "name,domains,aliases",
      '"Sample Law, LLP","sample-law.example.org;sample-law.example.com",Sample Sub',
      "Other Firm,other.example.com,",
    ].join("\n");
    const result = await asMember(f.owner, () => importDncCsv(csvForm(csv)));
    expect(result).toEqual({ ok: true, added: 1, merged: 1, errors: [] });

    const list = await listDnc(f.owner);
    expect(list).toHaveLength(2);
    const sample = list.find((e) => e.name === "Sample Law")!;
    expect(sample.domains).toEqual(["sample-law.example.com", "sample-law.example.org"]);
    expect(sample.aliases).toEqual(["Sample Parent", "Sample Sub"]);
    expect(sample.source).toBe("manual");
    expect(list.find((e) => e.name === "Other Firm")!.source).toBe("csv");
  });

  test("rows in one batch with the same name merge together", async () => {
    const out = await withAgency(f.agency.id, (tx) =>
      upsertDncEntries(
        tx,
        f.agency.id,
        [
          { name: "Batch Firm LLC", domains: ["batch.example.com"], aliases: [] },
          { name: "Batch Firm", domains: ["batch.example.net"], aliases: ["Batch Parent"] },
        ],
        "csv",
        f.owner.userId,
      ),
    );
    expect(out).toEqual({ added: 1, merged: 1 });
    const list = await listDnc(f.owner);
    expect(list).toHaveLength(1);
    expect(list[0]!.domains).toEqual(["batch.example.com", "batch.example.net"]);
  });

  test("an entry needs a name and a domain or alias, and domains must be valid", async () => {
    expect(await asMember(f.owner, () => addDncEntry({ name: "  ", domains: ["a.example.com"], aliases: [] }))).toEqual({
      ok: false,
      error: "Enter the company name.",
    });
    expect(await asMember(f.owner, () => addDncEntry({ name: "Lonely", domains: [], aliases: [] }))).toEqual({
      ok: false,
      error: "Add at least one domain or alias.",
    });
    const bad = await asMember(f.owner, () => addDncEntry({ name: "Bad", domains: ["nodot"], aliases: [] }));
    expect(bad.ok).toBe(false);
    expect(await listDnc(f.owner)).toEqual([]);
  });

  test("the upload must be a csv under 1 MB", async () => {
    const big = await asMember(f.owner, () => importDncCsv(csvForm("name,domains\n" + "x".repeat(1_048_576))));
    expect(big).toEqual({ ok: false, error: "That file is too large. Keep it under 1 MB." });
    const wrong = await asMember(f.owner, () => importDncCsv(csvForm("hello", "list.pdf", "application/pdf")));
    expect(wrong).toEqual({ ok: false, error: "Upload a .csv file." });
    const none = await asMember(f.owner, () => importDncCsv(new FormData()));
    expect(none).toEqual({ ok: false, error: "Choose a .csv file to upload." });
  });

  test("a recruiter cannot add, import or remove entries", async () => {
    const denied = { ok: false, error: "You do not have permission to change the do-not-contact list." };
    expect(await asMember(f.recA, () => addDncEntry({ name: "X Firm", domains: ["x.example.com"], aliases: [] }))).toEqual(denied);
    expect(await asMember(f.recA, () => importDncCsv(csvForm("name,domains\nX Firm,x.example.com")))).toEqual(denied);
    await asMember(f.owner, () => addDncEntry({ name: "Kept Firm", domains: ["kept.example.com"], aliases: [] }));
    const [entry] = await listDnc(f.recA);
    expect(await asMember(f.recA, () => removeDncEntry(entry!.id))).toEqual(denied);
    expect(await listDnc(f.recA)).toHaveLength(1);
  });

  test("removing an entry unblocks it for doNotContactMatch", async () => {
    await asMember(f.owner, () =>
      addDncEntry({ name: "Blocked Firm", domains: ["blocked.example.com"], aliases: ["Blocked Sub"] }),
    );
    const match = () => withAgency(f.agency.id, (tx) => doNotContactMatch(tx, { domain: "mail.blocked.example.com" }));
    expect(await match()).not.toBeNull();
    const [entry] = await listDnc(f.admin);
    expect(await asMember(f.admin, () => removeDncEntry(entry!.id))).toEqual({ ok: true });
    expect(await match()).toBeNull();
    expect(await asMember(f.admin, () => removeDncEntry(entry!.id))).toEqual({
      ok: false,
      error: "That entry was not found.",
    });
  });
});
