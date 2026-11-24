import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { withAgency } from "@/db/with-agency";
import { addSuppression } from "@/lib/ledger/record";
import * as actions from "@/lib/suppressions/actions";
import { addOptOut } from "@/lib/suppressions/actions";
import { listSuppressions } from "@/lib/suppressions/queries";
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

describe("addOptOut", () => {
  test("any member can add an opt-out, a second add reports already", async () => {
    expect(await asMember(f.recA, () => addOptOut("  Pat.Example@Example.com ", "asked by phone"))).toEqual({
      ok: true,
      result: "added",
    });
    expect(await asMember(f.recB, () => addOptOut("pat.example@example.com", ""))).toEqual({
      ok: true,
      result: "already",
    });
    const rows = await listSuppressions(f.owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "pat.example@example.com", reason: "manual", source: "manual" });
  });

  test("an invalid email is refused", async () => {
    const result = await asMember(f.recA, () => addOptOut("not an email", ""));
    expect(result).toEqual({ ok: false, error: "Enter one valid email address." });
    expect(await listSuppressions(f.owner)).toEqual([]);
  });

  test("there is no remove action", () => {
    expect(Object.keys(actions)).toEqual(["addOptOut"]);
  });
});

describe("listSuppressions", () => {
  test("filters by case-insensitive substring, treats % and _ literally, newest first", async () => {
    await withAgency(f.agency.id, async (tx) => {
      await addSuppression(tx, f.agency.id, { email: "first.person@example.com", reason: "opted_out", source: "gmail" });
      await addSuppression(tx, f.agency.id, { email: "second_person@example.org", reason: "bounced", source: "gmail" });
      await addSuppression(tx, f.agency.id, { email: "third@example.net", reason: "manual", source: "manual" });
    });
    expect((await listSuppressions(f.owner)).map((r) => r.email).sort()).toEqual([
      "first.person@example.com",
      "second_person@example.org",
      "third@example.net",
    ]);
    expect((await listSuppressions(f.owner, "PERSON")).map((r) => r.email).sort()).toEqual([
      "first.person@example.com",
      "second_person@example.org",
    ]);
    expect((await listSuppressions(f.owner, "_person")).map((r) => r.email)).toEqual(["second_person@example.org"]);
    expect(await listSuppressions(f.owner, "%")).toEqual([]);
    expect(await listSuppressions(f.owner, "  ")).toHaveLength(3);
  });

  test("returns newest first", async () => {
    await withAgency(f.agency.id, (tx) => addSuppression(tx, f.agency.id, { email: "old@example.com", reason: "bounced", source: "gmail" }));
    await withAgency(f.agency.id, (tx) => addSuppression(tx, f.agency.id, { email: "new@example.com", reason: "bounced", source: "gmail" }));
    expect((await listSuppressions(f.owner)).map((r) => r.email)).toEqual(["new@example.com", "old@example.com"]);
  });
});
