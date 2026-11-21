import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { setTestDb, type AppDb, type Tx } from "@/db/client";

export type TestDb = AppDb;

/**
 * Fresh in-memory Postgres (PGlite) with all migrations applied, registered as the app database.
 * After migrating, the session switches to the non-owner role rge_app, so the returned db
 * behaves like the production app connection: row-level security applies to every query.
 * Use asOwner() for setup that must bypass it.
 */
export async function createTestDb(): Promise<{ db: TestDb; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
  await client.exec("set role rge_app");
  const appDb = db as unknown as AppDb;
  setTestDb(appDb);
  return {
    db: appDb,
    close: async () => {
      setTestDb(undefined);
      await client.close();
    },
  };
}

/** Runs fn as the session (superuser/owner) role, bypassing row-level security. Test setup only. */
export async function asOwner<T>(db: TestDb, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role none`);
    return fn(tx);
  });
}

export type SeededAgency = {
  id: string;
  ownerId: string;
  adminId: string;
  recruiterId: string;
  recruiter2Id: string;
};

/** Inserts n agencies, each with an owner, an admin and two recruiters (users plus memberships). */
export async function seedAgencies(db: TestDb, n: number): Promise<SeededAgency[]> {
  return asOwner(db, async (tx) => {
    const seeded: SeededAgency[] = [];
    for (let i = 0; i < n; i++) {
      const tag = randomUUID().slice(0, 8);
      const [agency] = await tx
        .insert(schema.agencies)
        .values({ clerkOrgId: `org_test_${tag}`, name: `Test Agency ${i + 1}`, enabled: true })
        .returning();
      const roles = ["owner", "admin", "recruiter", "recruiter"] as const;
      const ids: string[] = [];
      for (const [j, role] of roles.entries()) {
        const [user] = await tx
          .insert(schema.users)
          .values({
            clerkUserId: `user_test_${tag}_${j}`,
            email: `${role}${j}.${tag}@example.test`,
            name: `Test ${role} ${j}`,
          })
          .returning();
        await tx.insert(schema.memberships).values({ agencyId: agency.id, userId: user.id, role });
        ids.push(user.id);
      }
      seeded.push({ id: agency.id, ownerId: ids[0], adminId: ids[1], recruiterId: ids[2], recruiter2Id: ids[3] });
    }
    return seeded;
  });
}

export type SeedFactOptions = {
  agencyId: string;
  mpcId: string;
  status?: "usable" | "interview_only" | "confirmed";
  text?: string;
  sourceKind?: "resume" | "notes" | "transcript" | "web" | "manual";
  sourceRef?: string | null;
};

/** Inserts one fact, bypassing row-level security. Test setup only. */
export async function seedFact(db: TestDb, opts: SeedFactOptions): Promise<{ id: string }> {
  return asOwner(db, async (tx) => {
    const [row] = await tx
      .insert(schema.mpcFacts)
      .values({
        agencyId: opts.agencyId,
        mpcId: opts.mpcId,
        text: opts.text ?? `Fact ${randomUUID().slice(0, 8)}`,
        sourceKind: opts.sourceKind ?? "notes",
        sourceRef: opts.sourceRef ?? null,
        status: opts.status ?? "usable",
      })
      .returning({ id: schema.mpcFacts.id });
    return row;
  });
}

/** Reads one fact, bypassing row-level security. Test assertions only. */
export async function getFact(db: TestDb, id: string) {
  return asOwner(db, async (tx) => {
    const [row] = await tx.select().from(schema.mpcFacts).where(sql`${schema.mpcFacts.id} = ${id}`);
    return row;
  });
}
