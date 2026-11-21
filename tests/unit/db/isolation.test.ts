import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { agencies, memberships, mpcFacts, mpcs, users } from "@/db/schema";
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

  test("every table, including global users, has RLS enabled and forced", async () => {
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
    for (const t of [...scoped, "users"]) expect(byName[t], t).toMatchObject({ enabled: true, forced: true });
  });

  test("src/db/rls.sql is the concatenation of the custom RLS migrations drizzle applies", () => {
    const dir = join(process.cwd(), "drizzle");
    const normalize = (s: string) => s.replace(/\r\n/g, "\n").trim();
    const rlsMigrations = readdirSync(dir)
      .filter((f) => /^\d{4}_rls.*\.sql$/.test(f))
      .sort();
    expect(rlsMigrations).toEqual(["0001_rls.sql", "0003_rls_users_memberships.sql"]);
    const combined = rlsMigrations.map((f) => normalize(readFileSync(join(dir, f), "utf8"))).join("\n\n");
    expect(combined).toBe(normalize(readFileSync(join(process.cwd(), "src/db/rls.sql"), "utf8")));
  });
});

describe("global users table", () => {
  test("an agency sees and edits only its own members; no context sees no users", async () => {
    const { db, agencies: [a, b] } = await setup();
    const aMembers = [a.ownerId, a.adminId, a.recruiterId, a.recruiter2Id].sort();
    const seenByA = await withAgency(a.id, (tx) => tx.select().from(users));
    expect(seenByA.map((u) => u.id).sort()).toEqual(aMembers);
    const updated = await withAgency(a.id, (tx) =>
      tx.update(users).set({ email: "hijack@example.test" }).where(eq(users.id, b.ownerId)).returning(),
    );
    expect(updated).toHaveLength(0);
    const [bOwner] = await asOwner(db, (tx) => tx.select().from(users).where(eq(users.id, b.ownerId)));
    expect(bOwner.email).not.toBe("hijack@example.test");
    expect(await db.select().from(users)).toHaveLength(0);
    // Own members stay editable, so the restriction is not simply "no updates".
    const renamed = await withAgency(a.id, (tx) =>
      tx.update(users).set({ name: "Renamed" }).where(eq(users.id, a.recruiterId)).returning(),
    );
    expect(renamed).toHaveLength(1);
  });

  test("rge_app cannot create users or change a user's identity", async () => {
    const { agencies: [a] } = await setup(1);
    await expect(
      withAgency(a.id, (tx) => tx.insert(users).values({ clerkUserId: "user_x", email: "x@example.test", name: "X" })),
    ).rejects.toThrow();
    await expect(
      withAgency(a.id, (tx) => tx.update(users).set({ clerkUserId: "user_stolen" }).where(eq(users.id, a.ownerId))),
    ).rejects.toThrow();
  });
});

describe("cross-agency links through foreign keys", () => {
  async function setupWithMpcs() {
    const ctx = await setup();
    const [a, b] = ctx.agencies;
    const [aMpc] = await withAgency(a.id, (tx) =>
      tx
        .insert(mpcs)
        .values({ agencyId: a.id, ownerUserId: a.recruiterId, headlineRole: "A role", location: "Phoenix, AZ" })
        .returning(),
    );
    const [bMpc] = await withAgency(b.id, (tx) =>
      tx
        .insert(mpcs)
        .values({ agencyId: b.id, ownerUserId: b.recruiterId, headlineRole: "B role", location: "Denver, CO" })
        .returning(),
    );
    return { ...ctx, a, b, aMpc, bMpc };
  }

  test("a child row in agency A cannot point at agency B's MPC", async () => {
    const { a, aMpc, bMpc } = await setupWithMpcs();
    await expect(
      withAgency(a.id, (tx) =>
        tx.insert(mpcFacts).values({ agencyId: a.id, mpcId: bMpc.id, text: "Fact", sourceKind: "manual" }),
      ),
    ).rejects.toThrow();
    // The same insert against A's own MPC succeeds, so the rejection is the cross-agency link.
    await withAgency(a.id, (tx) =>
      tx.insert(mpcFacts).values({ agencyId: a.id, mpcId: aMpc.id, text: "Fact", sourceKind: "manual" }),
    );
  });

  test("MPC owner and fact confirmer must be members of the same agency", async () => {
    const { a, b, aMpc } = await setupWithMpcs();
    await expect(
      withAgency(a.id, (tx) => tx.update(mpcs).set({ ownerUserId: b.recruiterId }).where(eq(mpcs.id, aMpc.id))),
    ).rejects.toThrow();
    await expect(
      withAgency(a.id, (tx) =>
        tx.insert(mpcFacts).values({
          agencyId: a.id,
          mpcId: aMpc.id,
          text: "Fact",
          sourceKind: "manual",
          confirmedBy: b.ownerId,
        }),
      ),
    ).rejects.toThrow();
  });

  test("rge_app cannot add members or move a membership to another user", async () => {
    const { a, b } = await setupWithMpcs();
    await expect(
      withAgency(a.id, (tx) => tx.insert(memberships).values({ agencyId: a.id, userId: b.ownerId, role: "owner" })),
    ).rejects.toThrow();
    await expect(
      withAgency(a.id, (tx) =>
        tx.update(memberships).set({ userId: b.ownerId }).where(eq(memberships.userId, a.recruiterId)),
      ),
    ).rejects.toThrow();
    const promoted = await withAgency(a.id, (tx) =>
      tx.update(memberships).set({ role: "admin" }).where(eq(memberships.userId, a.recruiterId)).returning(),
    );
    expect(promoted.map((m) => m.role)).toEqual(["admin"]);
  });
});

describe("runtime client", () => {
  test("fails with a clear error only when a connection is attempted without DATABASE_URL", () => {
    expect(() => neonDb("")).toThrow(/DATABASE_URL/);
  });
});
