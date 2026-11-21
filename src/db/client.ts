import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

/**
 * Runtime client: Neon over WebSockets (interactive transactions are required by withAgency).
 * DATABASE_URL is the pooled connection string for the runtime login role. rge_app and rge_system
 * are NOLOGIN roles: every query runs inside withAgency or withSystem, which SET LOCAL ROLE to one
 * of them, so the login role only needs membership in both WITH SET (drizzle/0009 grants it to
 * the migrating role; README "Database roles" covers a dedicated runtime role). Migrations use
 * DATABASE_URL_UNPOOLED as the owner, never this client.
 */
export function neonDb(url = process.env.DATABASE_URL): AppDb {
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Set it in .env.local to the pooled Neon connection string for the runtime role (see README, Database roles).",
    );
  }
  return drizzle({ client: new Pool({ connectionString: url }), schema });
}

let appDb: AppDb | undefined;
let testDb: AppDb | undefined;

/** Test only: register the PGlite database created by tests/helpers/test-db.ts. */
export function setTestDb(db: AppDb | undefined): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setTestDb is only available when NODE_ENV is 'test'");
  testDb = db;
}

/** Lazily resolves the database; importing this module never connects or throws. */
export function getDb(): AppDb {
  if (process.env.NODE_ENV === "test") {
    if (!testDb) throw new Error("No test database: call createTestDb() first.");
    return testDb;
  }
  return (appDb ??= neonDb());
}
