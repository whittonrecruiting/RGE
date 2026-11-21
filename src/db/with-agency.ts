import { sql } from "drizzle-orm";
import { getDb, type Tx } from "./client";

/**
 * Runs fn inside a transaction scoped to one agency. Row-level security (src/db/rls.sql)
 * limits every agency-owned table to rows of agencyId.
 *
 * Both settings are transaction-local, so a pooled connection never carries one agency's
 * context into the next request. SET LOCAL ROLE makes the policies apply even if the
 * connection were opened as a more privileged role (it fails loudly if that role cannot
 * assume rge_app).
 */
export async function withAgency<T>(agencyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`set local role rge_app`);
    await tx.execute(sql`select set_config('app.agency_id', ${agencyId}, true)`);
    return fn(tx);
  });
}
