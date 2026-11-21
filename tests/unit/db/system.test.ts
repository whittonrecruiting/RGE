import { afterEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { agencies, agencySettings, memberships, mpcs, users } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { withSystem } from "@/db/with-system";
import { createTestDb, seedAgencies } from "../../helpers/test-db";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

// Drizzle wraps driver errors ("Failed query: ..."); the Postgres message is on the cause.
const permissionDenied = (err: unknown) =>
  /permission denied/.test(String((err as { cause?: { message?: string } }).cause?.message ?? err));

async function setup(n = 2) {
  const t = await createTestDb();
  close = t.close;
  return { db: t.db, agencies: await seedAgencies(t.db, n) };
}

describe("withSystem (Clerk sync path)", () => {
  test("runs as rge_system and sees agencies, users and memberships across agencies", async () => {
    const { agencies: [a, b] } = await setup();
    const res = await withSystem(async (tx) => {
      const who = (await tx.execute(sql`select current_user as u`)) as unknown as { rows: { u: string }[] };
      return {
        user: who.rows[0].u,
        agencies: (await tx.select().from(agencies)).map((r) => r.id).sort(),
        users: (await tx.select().from(users)).length,
        memberships: (await tx.select().from(memberships)).length,
      };
    });
    expect(res).toEqual({ user: "rge_system", agencies: [a.id, b.id].sort(), users: 8, memberships: 8 });
  });

  test("can insert and update agencies, users and memberships", async () => {
    await setup(0);
    await withSystem(async (tx) => {
      const [ag] = await tx.insert(agencies).values({ clerkOrgId: "org_sys", name: "Sys" }).returning();
      const [u] = await tx.insert(users).values({ clerkUserId: "user_sys", email: "s@x.test", name: "S" }).returning();
      await tx.insert(memberships).values({ agencyId: ag.id, userId: u.id, role: "owner" });
      await tx.update(users).set({ clerkUserId: "user_sys2" });
    });
    expect(await withSystem((tx) => tx.select().from(memberships))).toHaveLength(1);
  });

  test("cannot read or write mpcs or other agency data", async () => {
    const { agencies: [a] } = await setup(1);
    await withAgency(a.id, (tx) =>
      tx.insert(mpcs).values({ agencyId: a.id, ownerUserId: a.recruiterId, headlineRole: "Nurse", location: "Austin, TX" }),
    );
    await expect(withSystem((tx) => tx.select().from(mpcs))).rejects.toSatisfy(permissionDenied);
    await expect(
      withSystem((tx) =>
        tx.insert(mpcs).values({ agencyId: a.id, ownerUserId: a.recruiterId, headlineRole: "X", location: "Y" }),
      ),
    ).rejects.toSatisfy(permissionDenied);
    await expect(withSystem((tx) => tx.delete(mpcs))).rejects.toSatisfy(permissionDenied);
    await expect(withSystem((tx) => tx.select().from(agencySettings))).rejects.toSatisfy(permissionDenied);
  });

  test("rge_system does not bypass row-level security and is not a login role", async () => {
    const { db } = await setup(0);
    const res = (await db.execute(
      sql`select rolbypassrls, rolcanlogin, rolsuper from pg_roles where rolname = 'rge_system'`,
    )) as unknown as { rows: { rolbypassrls: boolean; rolcanlogin: boolean; rolsuper: boolean }[] };
    expect(res.rows).toEqual([{ rolbypassrls: false, rolcanlogin: false, rolsuper: false }]);
  });

  test("the app role still cannot create users or memberships", async () => {
    const { agencies: [a] } = await setup(1);
    await expect(
      withAgency(a.id, (tx) => tx.insert(users).values({ clerkUserId: "user_x", email: "x@x.test", name: "X" })),
    ).rejects.toSatisfy(permissionDenied);
  });
});
