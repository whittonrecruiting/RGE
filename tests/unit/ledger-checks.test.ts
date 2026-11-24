import { afterEach, describe, expect, test } from "vitest";
import { doNotContact } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { companyActivity, doNotContactMatch, lastContactAt, suppressionFor } from "@/lib/ledger/checks";
import { recordEvents, type LedgerInput } from "@/lib/ledger/record";
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

let n = 0;
const ev = (type: LedgerInput["type"], email: string, at: string): LedgerInput => ({
  type,
  email,
  occurredAt: new Date(at),
  source: "gmail",
  dedupeKey: `k${++n}`,
});

describe("read checks", () => {
  test("lastContactAt ignores denied, drafted and proposed events", async () => {
    const { a } = await setup();
    await withAgency(a.id, async (tx) => {
      await recordEvents(
        tx,
        a.id,
        [
          ev("sent", "pat@acme-example.com", "2026-10-01T00:00:00Z"),
          ev("received", "Pat@acme-example.com", "2026-10-05T00:00:00Z"),
          ev("denied", "pat@acme-example.com", "2026-11-10T00:00:00Z"),
          ev("drafted", "pat@acme-example.com", "2026-11-11T00:00:00Z"),
          ev("proposed", "pat@acme-example.com", "2026-11-12T00:00:00Z"),
        ],
        { ownDomains: [] },
      );
      expect(await lastContactAt(tx, "PAT@acme-example.com")).toEqual(new Date("2026-10-05T00:00:00Z"));
      expect(await lastContactAt(tx, "nobody@example.net")).toBeNull();
    });
  });

  test("suppressionFor finds a suppressed address regardless of case", async () => {
    const { a } = await setup();
    await withAgency(a.id, async (tx) => {
      await recordEvents(tx, a.id, [ev("opted_out", "Pat@acme-example.com", "2026-10-05T00:00:00Z")], { ownDomains: [] });
      expect((await suppressionFor(tx, "pat@ACME-example.com"))?.reason).toBe("opted_out");
      expect(await suppressionFor(tx, "other@acme-example.com")).toBeNull();
    });
  });

  test("companyActivity lists distinct emails contacted since the date and the latest decline", async () => {
    const { a } = await setup();
    await withAgency(a.id, async (tx) => {
      await recordEvents(
        tx,
        a.id,
        [
          ev("sent", "pat@acme-example.com", "2026-09-01T00:00:00Z"),
          ev("sent", "pat@acme-example.com", "2026-10-10T00:00:00Z"),
          ev("follow_up_sent", "pat@acme-example.com", "2026-10-14T00:00:00Z"),
          ev("sent", "sam@acme-example.com", "2026-10-12T00:00:00Z"),
          ev("replied_declined", "sam@acme-example.com", "2026-10-13T00:00:00Z"),
          ev("replied_declined", "sam@acme-example.com", "2026-10-20T00:00:00Z"),
        ],
        { ownDomains: [] },
      );
      const r = await companyActivity(tx, "acme-example.com", new Date("2026-10-01T00:00:00Z"));
      expect(r.companyId).not.toBeNull();
      expect(r.contactedEmails).toEqual(["pat@acme-example.com", "sam@acme-example.com"]);
      expect(r.declinedAt).toEqual(new Date("2026-10-20T00:00:00Z"));
      expect(r.isClient).toBe(false);
      expect(await companyActivity(tx, "unknown-example.org", new Date("2026-10-01T00:00:00Z"))).toEqual({
        companyId: null,
        contactedEmails: [],
        declinedAt: null,
        isClient: false,
      });
    });
  });

  test("doNotContactMatch finds an entry by alias and by subdomain", async () => {
    const { a } = await setup();
    await withAgency(a.id, async (tx) => {
      await tx.insert(doNotContact).values({
        agencyId: a.id,
        name: "Globex Example Inc",
        domains: ["globex-example.com"],
        aliases: ["Initech Example"],
        source: "manual",
      });
      expect((await doNotContactMatch(tx, { domain: "mail.globex-example.com" }))?.name).toBe("Globex Example Inc");
      expect((await doNotContactMatch(tx, { name: "initech example llc" }))?.name).toBe("Globex Example Inc");
      expect(await doNotContactMatch(tx, { domain: "other-example.net", name: "Other" })).toBeNull();
    });
  });
});
