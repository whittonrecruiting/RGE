import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

/**
 * Runtime client: Neon over WebSockets (interactive transactions are required by withAgency).
 * Use the pooled connection string, logged in as the non-owner role rge_app.
 */
export function neonDb(url = process.env.DATABASE_URL): AppDb {
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Set it in .env.local to the pooled Neon connection string for the rge_app role.",
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
