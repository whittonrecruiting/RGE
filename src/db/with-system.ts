import { sql } from "drizzle-orm";
import { getDb, type Tx } from "./client";

/**
 * Runs fn inside a transaction as rge_system, the role for Clerk sync and the sign-in membership
 * lookup. rge_system can read and write agencies, users and memberships across agencies (explicit
 * policies, no BYPASSRLS) and has no privileges on mpcs, mpc_* or any other agency data.
 *
 * Use it only where no agency context exists yet. Everything else goes through withAgency.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`set local role rge_system`);
    return fn(tx);
  });
}
