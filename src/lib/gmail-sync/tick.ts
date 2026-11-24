// One cron tick: sync every connected inbox of every enabled agency, least recently synced first,
// until the deadline. rge_system only lists agencies; all inbox work runs per agency in withAgency.

import { asc, eq, sql } from "drizzle-orm";
import { agencies, inboxCredentials, inboxes } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { withSystem } from "@/db/with-system";
import { googleApi, type GoogleApi } from "@/lib/google/client";
import { syncInbox } from "./sync-inbox";

export async function runSyncTick(deadline: number, api: GoogleApi = googleApi()): Promise<{ inboxes: number; inserted: number }> {
  const agencyRows = await withSystem((tx) => tx.select({ id: agencies.id }).from(agencies).where(eq(agencies.enabled, true)));
  let synced = 0;
  let inserted = 0;
  for (const agency of agencyRows) {
    if (Date.now() > deadline) break;
    try {
      const rows = await withAgency(agency.id, (tx) =>
        tx
          .select({ id: inboxes.id })
          .from(inboxes)
          .innerJoin(inboxCredentials, eq(inboxCredentials.inboxId, inboxes.id))
          .where(eq(inboxes.status, "connected"))
          .orderBy(sql`${inboxes.lastSyncedAt} asc nulls first`, asc(inboxes.id)),
      );
      for (const row of rows) {
        if (Date.now() > deadline) break;
        try {
          const out = await syncInbox(agency.id, row.id, deadline, api);
          inserted += out.inserted;
        } catch {
          // One inbox failing (for example a database error) must not stop the others.
          console.warn("Gmail sync failed for one inbox");
        }
        synced++;
      }
    } catch {
      // One agency failing (for example listing its inboxes) must not stop later agencies.
      console.warn("Gmail sync failed for one agency");
    }
  }
  return { inboxes: synced, inserted };
}
