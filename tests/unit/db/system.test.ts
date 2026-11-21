import { afterEach, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { agencies, agencySettings, aiUsage, memberships, mpcDocuments, mpcFacts, mpcs, users } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { withSystem } from "@/db/with-system";
import { asOwner, createTestDb, seedAgencies } from "../../helpers/test-db";

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

  test("cannot delete agencies, users or memberships, so no cascade can reach agency data", async () => {
    const { db, agencies: [a] } = await setup(1);
    await withAgency(a.id, (tx) =>
      tx.insert(mpcs).values({ agencyId: a.id, ownerUserId: a.recruiterId, headlineRole: "Nurse", location: "Austin, TX" }),
    );
    await expect(withSystem((tx) => tx.delete(agencies).where(eq(agencies.id, a.id)))).rejects.toSatisfy(permissionDenied);
    await expect(withSystem((tx) => tx.delete(users).where(eq(users.id, a.recruiterId)))).rejects.toSatisfy(permissionDenied);
    await expect(withSystem((tx) => tx.delete(memberships))).rejects.toSatisfy(permissionDenied);
    expect(await asOwner(db, (tx) => tx.select().from(mpcs))).toHaveLength(1);
    expect(await asOwner(db, (tx) => tx.select().from(memberships))).toHaveLength(4);
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

describe("agencies grants and the tenant gate", () => {
  test("rge_app cannot delete agencies, change clerk_org_id or enabled, but can change the time zone", async () => {
    const { db, agencies: [a] } = await setup(1);
    await expect(withAgency(a.id, (tx) => tx.delete(agencies).where(eq(agencies.id, a.id)))).rejects.toSatisfy(permissionDenied);
    await expect(
      withAgency(a.id, (tx) => tx.update(agencies).set({ clerkOrgId: "org_stolen" }).where(eq(agencies.id, a.id))),
    ).rejects.toSatisfy(permissionDenied);
    await expect(
      withAgency(a.id, (tx) => tx.update(agencies).set({ enabled: false }).where(eq(agencies.id, a.id))),
    ).rejects.toSatisfy(permissionDenied);
    await expect(
      withAgency(a.id, (tx) => tx.insert(agencies).values({ clerkOrgId: "org_new", name: "New", enabled: true })),
    ).rejects.toSatisfy(permissionDenied);
    const updated = await withAgency(a.id, (tx) =>
      tx.update(agencies).set({ timeZone: "America/Denver", updatedAt: sql`now()` }).where(eq(agencies.id, a.id)).returning({ id: agencies.id }),
    );
    expect(updated).toHaveLength(1);
    const [row] = await asOwner(db, (tx) => tx.select().from(agencies).where(eq(agencies.id, a.id)));
    expect(row).toMatchObject({ timeZone: "America/Denver", enabled: true });
  });

  test("rge_system cannot enable an agency or create an enabled one", async () => {
    const { db, agencies: [a] } = await setup(1);
    await asOwner(db, (tx) => tx.update(agencies).set({ enabled: false }).where(eq(agencies.id, a.id)));
    await expect(
      withSystem((tx) => tx.update(agencies).set({ enabled: true }).where(eq(agencies.id, a.id))),
    ).rejects.toSatisfy(permissionDenied);
    await expect(
      withSystem((tx) => tx.insert(agencies).values({ clerkOrgId: "org_on", name: "On", enabled: true })),
    ).rejects.toThrow(/row-level security|Failed query/);
    // A disabled agency can still be created and renamed by Clerk sync.
    await withSystem(async (tx) => {
      await tx.insert(agencies).values({ clerkOrgId: "org_off", name: "Off" });
      await tx.update(agencies).set({ name: "Renamed" }).where(eq(agencies.clerkOrgId, "org_off"));
    });
    const rows = await asOwner(db, (tx) => tx.select().from(agencies));
    expect(rows.find((r) => r.clerkOrgId === "org_off")).toMatchObject({ name: "Renamed", enabled: false });
    expect(rows.find((r) => r.id === a.id)?.enabled).toBe(false);
  });

  test("new agencies start disabled", async () => {
    const { db } = await setup(0);
    await asOwner(db, (tx) => tx.insert(agencies).values({ clerkOrgId: "org_default", name: "Default" }));
    const [row] = await asOwner(db, (tx) => tx.select().from(agencies));
    expect(row.enabled).toBe(false);
  });
});

describe("ai_usage", () => {
  test("rge_app can insert and read its own agency's rows only, and cannot change or delete them", async () => {
    const { agencies: [a, b] } = await setup(2);
    const row = { purpose: "extraction" as const, model: "m", inputTokens: 1, outputTokens: 2, webSearches: 0 };
    await withAgency(a.id, (tx) => tx.insert(aiUsage).values({ ...row, agencyId: a.id, userId: a.recruiterId }));
    await expect(
      withAgency(a.id, (tx) => tx.insert(aiUsage).values({ ...row, agencyId: b.id, userId: b.recruiterId })),
    ).rejects.toThrow();
    expect(await withAgency(a.id, (tx) => tx.select().from(aiUsage))).toHaveLength(1);
    expect(await withAgency(b.id, (tx) => tx.select().from(aiUsage))).toHaveLength(0);
    await expect(withAgency(a.id, (tx) => tx.update(aiUsage).set({ inputTokens: 0 }))).rejects.toSatisfy(permissionDenied);
    await expect(withAgency(a.id, (tx) => tx.delete(aiUsage))).rejects.toSatisfy(permissionDenied);
    await expect(withSystem((tx) => tx.select().from(aiUsage))).rejects.toSatisfy(permissionDenied);
  });

  test("the user must be a member of the same agency", async () => {
    const { agencies: [a, b] } = await setup(2);
    await expect(
      withAgency(a.id, (tx) =>
        tx.insert(aiUsage).values({ agencyId: a.id, userId: b.recruiterId, purpose: "find_more", model: "m" }),
      ),
    ).rejects.toThrow();
  });
});

describe("fact source documents", () => {
  test("deleting a document clears the fact's link and keeps the fact and its agency", async () => {
    const { db, agencies: [a, b] } = await setup(2);
    const [mpc] = await withAgency(a.id, (tx) =>
      tx.insert(mpcs).values({ agencyId: a.id, ownerUserId: a.recruiterId, headlineRole: "R", location: "L" }).returning(),
    );
    const [doc] = await withAgency(a.id, (tx) =>
      tx.insert(mpcDocuments).values({ agencyId: a.id, mpcId: mpc.id, kind: "resume", filename: "cv.pdf", text: "x", createdBy: a.recruiterId }).returning(),
    );
    const [fact] = await withAgency(a.id, (tx) =>
      tx.insert(mpcFacts).values({ agencyId: a.id, mpcId: mpc.id, text: "F", sourceKind: "resume", sourceRef: "cv.pdf", sourceDocumentId: doc.id }).returning(),
    );
    await asOwner(db, (tx) => tx.delete(mpcDocuments).where(eq(mpcDocuments.id, doc.id)));
    const [after] = await asOwner(db, (tx) => tx.select().from(mpcFacts).where(eq(mpcFacts.id, fact.id)));
    expect(after).toMatchObject({ agencyId: a.id, sourceDocumentId: null, sourceRef: "cv.pdf" });
    // A fact cannot point at another agency's document.
    const [bMpc] = await withAgency(b.id, (tx) =>
      tx.insert(mpcs).values({ agencyId: b.id, ownerUserId: b.recruiterId, headlineRole: "R", location: "L" }).returning(),
    );
    const [bDoc] = await withAgency(b.id, (tx) =>
      tx.insert(mpcDocuments).values({ agencyId: b.id, mpcId: bMpc.id, kind: "resume", filename: "b.pdf", text: "x", createdBy: b.recruiterId }).returning(),
    );
    await expect(
      withAgency(a.id, (tx) =>
        tx.insert(mpcFacts).values({ agencyId: a.id, mpcId: mpc.id, text: "G", sourceKind: "resume", sourceDocumentId: bDoc.id }),
      ),
    ).rejects.toThrow();
  });
});

describe("session role", () => {
  test("the migrating role is a member of rge_app and rge_system with SET", async () => {
    const { db } = await setup(0);
    const res = (await asOwner(db, (tx) =>
      tx.execute(sql`select pg_has_role(current_user, 'rge_app', 'SET') as app, pg_has_role(current_user, 'rge_system', 'SET') as sys,
        exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.roleid
                where r.rolname = 'rge_app' and m.member = (select oid from pg_roles where rolname = current_user) and m.set_option) as explicit`),
    )) as unknown as { rows: { app: boolean; sys: boolean; explicit: boolean }[] };
    expect(res.rows[0]).toEqual({ app: true, sys: true, explicit: true });
  });
});
