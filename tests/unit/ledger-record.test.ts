import { afterEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { companies, companyDomains, contacts, inboxes, ledgerEvents, suppressions } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { addSuppression, ownAddresses, ownDomains, recordEvents, type LedgerInput } from "@/lib/ledger/record";
import { createTestDb, seedAgencies } from "../helpers/test-db";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup() {
  const t = await createTestDb();
  close = t.close;
  const [a] = await seedAgencies(t.db, 1);
  return { a: a! };
}

const input = (extra: Partial<LedgerInput> = {}): LedgerInput => ({
  type: "sent",
  email: "Pat.Lee@Acme-Example.com",
  name: "Pat Lee",
  occurredAt: new Date("2026-11-01T12:00:00Z"),
  source: "gmail",
  dedupeKey: "gmail:m1",
  ...extra,
});

describe("recordEvents", () => {
  test("recording a sent event creates company, domain and contact once", async () => {
    const { a } = await setup();
    const first = await withAgency(a.id, (tx) => recordEvents(tx, a.id, [input()], { ownDomains: [] }));
    const second = await withAgency(a.id, (tx) => recordEvents(tx, a.id, [input()], { ownDomains: [] }));
    expect(first).toEqual({ inserted: 1, skipped: 0 });
    expect(second).toEqual({ inserted: 0, skipped: 1 });
    await withAgency(a.id, async (tx) => {
      expect(await tx.select().from(ledgerEvents)).toHaveLength(1);
      const cs = await tx.select().from(contacts);
      expect(cs).toHaveLength(1);
      expect(cs[0]!.email).toBe("pat.lee@acme-example.com");
      expect(cs[0]!.name).toBe("Pat Lee");
      const co = await tx.select().from(companies);
      expect(co).toHaveLength(1);
      expect(co[0]!.name).toBe("acme-example.com");
      expect(await tx.select().from(companyDomains)).toHaveLength(1);
    });
  });

  test("free-mail and own-domain addresses never create companies", async () => {
    const { a } = await setup();
    const r = await withAgency(a.id, (tx) =>
      recordEvents(
        tx,
        a.id,
        [
          input({ email: "someone@gmail.com", dedupeKey: "k1" }),
          input({ email: "me@own-example.org", dedupeKey: "k2" }),
          input({ email: "not an address", dedupeKey: "k3" }),
        ],
        { ownDomains: ["own-example.org"] },
      ),
    );
    expect(r).toEqual({ inserted: 2, skipped: 1 });
    await withAgency(a.id, async (tx) => {
      expect(await tx.select().from(companies)).toHaveLength(0);
      expect(await tx.select().from(contacts)).toHaveLength(2);
    });
  });

  test("a name fills in only when the contact had none", async () => {
    const { a } = await setup();
    await withAgency(a.id, async (tx) => {
      await recordEvents(tx, a.id, [input({ name: null, dedupeKey: "n1" })], { ownDomains: [] });
      await recordEvents(tx, a.id, [input({ name: "Pat Lee", dedupeKey: "n2" })], { ownDomains: [] });
      await recordEvents(tx, a.id, [input({ name: "Other Name", dedupeKey: "n3" })], { ownDomains: [] });
      const [c] = await tx.select().from(contacts);
      expect(c!.name).toBe("Pat Lee");
    });
  });

  test("bounced input adds a permanent suppression and a second bounce reports already", async () => {
    const { a } = await setup();
    await withAgency(a.id, async (tx) => {
      await recordEvents(tx, a.id, [input({ type: "bounced", dedupeKey: "b1" })], { ownDomains: [] });
      const rows = await tx.select().from(suppressions);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.reason).toBe("bounced");
      expect(rows[0]!.email).toBe("pat.lee@acme-example.com");
      expect(await addSuppression(tx, a.id, { email: "PAT.LEE@acme-example.com", reason: "bounced", source: "gmail" })).toBe("already");
      expect(await addSuppression(tx, a.id, { email: "new@example.net", reason: "manual", source: "manual" })).toBe("added");
      await expect(addSuppression(tx, a.id, { email: "nope", reason: "manual", source: "manual" })).rejects.toThrow("Invalid email");
    });
  });

  test("agreement_signed with only a company name marks a new company as client", async () => {
    const { a } = await setup();
    const r = await withAgency(a.id, (tx) =>
      recordEvents(
        tx,
        a.id,
        [{ type: "agreement_signed", companyName: "Northwind Example LLC", occurredAt: new Date("2026-11-02T00:00:00Z"), source: "manual", dedupeKey: "ag1" }],
        { ownDomains: [] },
      ),
    );
    expect(r.inserted).toBe(1);
    await withAgency(a.id, async (tx) => {
      const co = await tx.select().from(companies).where(eq(companies.name, "Northwind Example LLC"));
      expect(co).toHaveLength(1);
      expect(co[0]!.isClient).toBe(true);
    });
  });
});

describe("recordEvents invariants", () => {
  test("duplicate or repeated opt-outs leave exactly one suppression, created by recordEvents", async () => {
    const { a } = await setup();
    await withAgency(a.id, async (tx) => {
      const o = input({ type: "opted_out", dedupeKey: "o1" });
      await recordEvents(tx, a.id, [o, o], { ownDomains: [] });
      expect(await tx.select().from(suppressions)).toHaveLength(1);
      const r = await recordEvents(tx, a.id, [input({ type: "bounced", dedupeKey: "o2" })], { ownDomains: [] });
      expect(r.inserted).toBe(1);
      const rows = await tx.select().from(suppressions);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.reason).toBe("opted_out");
    });
  });

  test("a repeated company-name agreement_signed creates no second company", async () => {
    const { a } = await setup();
    await withAgency(a.id, async (tx) => {
      const ag = (k: string): LedgerInput => ({ type: "agreement_signed", companyName: "Northwind Example LLC", occurredAt: new Date("2026-11-02T00:00:00Z"), source: "manual", dedupeKey: k });
      await recordEvents(tx, a.id, [ag("a1")], { ownDomains: [] });
      await recordEvents(tx, a.id, [ag("a2"), ag("a1")], { ownDomains: [] });
      expect(await tx.select().from(companies)).toHaveLength(1);
    });
  });

  test("agreement_signed with a free-mail email and a company name marks the company as client", async () => {
    const { a } = await setup();
    await withAgency(a.id, async (tx) => {
      await recordEvents(
        tx,
        a.id,
        [{ type: "agreement_signed", email: "owner@gmail.com", companyName: "Fabrikam Example", occurredAt: new Date("2026-11-02T00:00:00Z"), source: "manual", dedupeKey: "f1" }],
        { ownDomains: [] },
      );
      const co = await tx.select().from(companies);
      expect(co).toHaveLength(1);
      expect(co[0]!.isClient).toBe(true);
    });
  });
});

describe("ownDomains", () => {
  test("returns distinct normalized domains of the agency inboxes", async () => {
    const { a } = await setup();
    await withAgency(a.id, async (tx) => {
      const base = { agencyId: a.id, userId: a.recruiterId, backfillFrom: new Date("2025-11-01T00:00:00Z") };
      await tx.insert(inboxes).values([
        { ...base, email: "One@Own-Example.org", status: "connected" as const },
        { ...base, email: "two@own-example.org", status: "disconnected" as const },
        { ...base, email: "three@other-example.net", status: "connected" as const },
        { ...base, email: "Recruiter.Example@Gmail.com", status: "connected" as const },
      ]);
      // A free-mail inbox never makes its whole domain "own".
      expect((await ownDomains(tx)).sort()).toEqual(["other-example.net", "own-example.org"]);
      expect((await ownAddresses(tx)).sort()).toEqual([
        "one@own-example.org",
        "recruiter.example@gmail.com",
        "three@other-example.net",
        "two@own-example.org",
      ]);
    });
  });
});
