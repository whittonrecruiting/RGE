import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { agencies, memberships, mpcs } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { neonDb } from "@/db/client";
import { asOwner, createTestDb, seedAgencies } from "../../helpers/test-db";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(n = 2) {
  const t = await createTestDb();
  close = t.close;
  const seeded = await seedAgencies(t.db, n);
  return { db: t.db, agencies: seeded };
}

async function currentUser(q: { execute: (s: ReturnType<typeof sql>) => Promise<unknown> }) {
  const res = (await q.execute(sql`select current_user as u`)) as { rows: { u: string }[] };
  return res.rows[0].u;
}

describe("agency isolation (row-level security)", () => {
  test("agency A cannot read or write agency B rows", async () => {
    const { agencies: [a, b] } = await setup();
    await withAgency(b.id, (tx) =>
      tx.insert(mpcs).values({ agencyId: b.id, ownerUserId: b.recruiterId, headlineRole: "Nurse", location: "Austin, TX" }),
    );
    const seenByA = await withAgency(a.id, (tx) => tx.select().from(mpcs));
    expect(seenByA).toHaveLength(0);
    await expect(
      withAgency(a.id, (tx) =>
        tx.insert(mpcs).values({ agencyId: b.id, ownerUserId: b.recruiterId, headlineRole: "X", location: "Y" }),
      ),
    ).rejects.toThrow();
  });

  test("query without agency context returns nothing", async () => {
    const { db, agencies: [, b] } = await setup();
    await withAgency(b.id, (tx) =>
      tx.insert(mpcs).values({ agencyId: b.id, ownerUserId: b.recruiterId, headlineRole: "Nurse", location: "Austin, TX" }),
    );
    // The row really exists (owner view), so the empty result below is RLS, not an empty table.
    expect(await asOwner(db, (tx) => tx.select().from(mpcs))).toHaveLength(1);
    expect(await currentUser(db)).toBe("rge_app");
    expect(await db.select().from(mpcs)).toHaveLength(0);
  });

  test("withAgency runs as the non-owner rge_app role so policies apply", async () => {
    const { agencies: [a] } = await setup(1);
    expect(await withAgency(a.id, (tx) => currentUser(tx))).toBe("rge_app");
  });

  test("agency context does not leak between calls", async () => {
    const { db, agencies: [a, b] } = await setup();
    await withAgency(a.id, (tx) =>
      tx.insert(mpcs).values({ agencyId: a.id, ownerUserId: a.recruiterId, headlineRole: "A role", location: "Phoenix, AZ" }),
    );
    await withAgency(b.id, (tx) =>
      tx.insert(mpcs).values({ agencyId: b.id, ownerUserId: b.recruiterId, headlineRole: "B role", location: "Denver, CO" }),
    );
    const seenByA = await withAgency(a.id, (tx) => tx.select().from(mpcs));
    expect(seenByA.map((r) => r.agencyId)).toEqual([a.id]);
    const seenByB = await withAgency(b.id, (tx) => tx.select().from(mpcs));
    expect(seenByB.map((r) => r.agencyId)).toEqual([b.id]);
    // After a transaction-local setting ends, a bare query sees nothing (and does not error).
    expect(await db.select().from(mpcs)).toHaveLength(0);
  });

  test("agency A cannot update or delete agency B rows", async () => {
    const { db, agencies: [a, b] } = await setup();
    await withAgency(b.id, (tx) =>
      tx.insert(mpcs).values({ agencyId: b.id, ownerUserId: b.recruiterId, headlineRole: "Nurse", location: "Austin, TX" }),
    );
    const updated = await withAgency(a.id, (tx) => tx.update(mpcs).set({ headlineRole: "Hijacked" }).returning());
    const deleted = await withAgency(a.id, (tx) => tx.delete(mpcs).returning());
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    const [row] = await asOwner(db, (tx) => tx.select().from(mpcs));
    expect(row.headlineRole).toBe("Nurse");
  });

  test("an agency sees only its own agency row and memberships", async () => {
    const { agencies: [a] } = await setup();
    const seen = await withAgency(a.id, async (tx) => ({
      agencies: await tx.select().from(agencies),
      memberships: await tx.select().from(memberships),
    }));
    expect(seen.agencies.map((r) => r.id)).toEqual([a.id]);
    expect(seen.memberships).toHaveLength(4);
    expect(new Set(seen.memberships.map((m) => m.agencyId))).toEqual(new Set([a.id]));
    expect(seen.memberships.map((m) => m.role).sort()).toEqual(["admin", "owner", "recruiter", "recruiter"]);
  });

  test("every agency-owned table has RLS enabled and forced; users is global", async () => {
    const { db } = await setup(1);
    const res = (await asOwner(db, (tx) =>
      tx.execute(sql`
        select relname, relrowsecurity as enabled, relforcerowsecurity as forced
        from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`),
    )) as { rows: { relname: string; enabled: boolean; forced: boolean }[] };
    const byName = Object.fromEntries(res.rows.map((r) => [r.relname, r]));
    const scoped = [
      "agencies", "memberships", "mpcs", "mpc_credentials", "mpc_facts",
      "mpc_restrictions", "mpc_consents", "mpc_documents", "agency_settings",
    ];
    expect(Object.keys(byName).sort()).toEqual([...scoped, "users"].sort());
    for (const t of scoped) expect(byName[t], t).toMatchObject({ enabled: true, forced: true });
    expect(byName.users).toMatchObject({ enabled: false });
  });

  test("src/db/rls.sql is the custom migration that drizzle applies", () => {
    const dir = join(process.cwd(), "drizzle");
    const rlsMigration = readdirSync(dir).find((f) => f.endsWith(".sql") && f.includes("rls"));
    expect(rlsMigration).toBeDefined();
    const normalize = (s: string) => s.replace(/\r\n/g, "\n").trim();
    expect(normalize(readFileSync(join(dir, rlsMigration!), "utf8"))).toBe(
      normalize(readFileSync(join(process.cwd(), "src/db/rls.sql"), "utf8")),
    );
  });
});

describe("runtime client", () => {
  test("fails with a clear error only when a connection is attempted without DATABASE_URL", () => {
    expect(() => neonDb("")).toThrow(/DATABASE_URL/);
  });
});
