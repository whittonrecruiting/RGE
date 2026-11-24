import { afterEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { contacts, inboxCredentials, inboxes, ledgerEvents, suppressions } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { createTestDb, seedAgencies } from "../../helpers/test-db";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

// Drizzle wraps driver errors ("Failed query: ..."); the Postgres message is on the cause.
const rejectsWith = (p: Promise<unknown>, re: RegExp) =>
  expect(p).rejects.toSatisfy((e: unknown) => re.test(String((e as { cause?: { message?: string } }).cause?.message ?? e)));

async function setup() {
  const t = await createTestDb();
  close = t.close;
  const [a, b] = await seedAgencies(t.db, 2);
  return { a, b };
}

const event = (agencyId: string, extra: Partial<typeof ledgerEvents.$inferInsert> = {}) => ({
  agencyId,
  type: "sent" as const,
  email: "pat@example.com",
  source: "rge" as const,
  dedupeKey: `k-${Math.random()}`,
  occurredAt: new Date("2026-11-01T12:00:00Z"),
  ...extra,
});

describe("ledger and suppression grants", () => {
  test("rge_app cannot update or delete ledger_events or suppressions", async () => {
    const { a } = await setup();
    await withAgency(a.id, async (tx) => {
      await tx.insert(ledgerEvents).values(event(a.id));
      await tx.insert(suppressions).values({ agencyId: a.id, email: "gone@example.com", reason: "opted_out", source: "manual" });
    });
    // Each attempt runs in its own transaction: a permission error aborts the transaction.
    await rejectsWith(withAgency(a.id, (tx) => tx.update(ledgerEvents).set({ note: "x" })), /permission denied/);
    await rejectsWith(withAgency(a.id, (tx) => tx.delete(ledgerEvents)), /permission denied/);
    await rejectsWith(withAgency(a.id, (tx) => tx.update(suppressions).set({ note: "x" })), /permission denied/);
    await rejectsWith(withAgency(a.id, (tx) => tx.delete(suppressions)), /permission denied/);
  });

  test("agency B cannot see agency A's ledger, suppressions, inboxes or credentials", async () => {
    const { a, b } = await setup();
    await withAgency(a.id, async (tx) => {
      await tx.insert(ledgerEvents).values(event(a.id));
      await tx.insert(suppressions).values({ agencyId: a.id, email: "gone@example.com", reason: "bounced", source: "gmail" });
      const [inbox] = await tx
        .insert(inboxes)
        .values({ agencyId: a.id, userId: a.recruiterId, email: "rec@example.org", status: "connected", backfillFrom: new Date("2025-11-01T00:00:00Z") })
        .returning();
      await tx.insert(inboxCredentials).values({ agencyId: a.id, inboxId: inbox.id, refreshTokenEnc: "enc", scopes: ["s"] });
    });
    expect(await withAgency(a.id, (tx) => tx.select().from(inboxCredentials))).toHaveLength(1);
    for (const table of [ledgerEvents, suppressions, inboxes, inboxCredentials]) {
      expect(await withAgency(b.id, (tx) => tx.select().from(table))).toHaveLength(0);
    }
  });

  test("a ledger event cannot reference another agency's contact", async () => {
    const { a, b } = await setup();
    const [bContact] = await withAgency(b.id, (tx) =>
      tx.insert(contacts).values({ agencyId: b.id, email: "lee@example.net" }).returning(),
    );
    await rejectsWith(
      withAgency(a.id, (tx) => tx.insert(ledgerEvents).values(event(a.id, { contactId: bContact.id }))),
      /foreign key/,
    );
    const [aContact] = await withAgency(a.id, (tx) =>
      tx.insert(contacts).values({ agencyId: a.id, email: "lee@example.net" }).returning(),
    );
    await withAgency(a.id, (tx) => tx.insert(ledgerEvents).values(event(a.id, { contactId: aContact.id })));
    expect(await withAgency(a.id, (tx) => tx.select().from(ledgerEvents).where(eq(ledgerEvents.contactId, aContact.id)))).toHaveLength(1);
  });
});
