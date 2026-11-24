import { desc, ilike } from "drizzle-orm";
import { suppressions, type LedgerSource, type SuppressionReason } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import type { Member } from "@/lib/auth";

export const SUPPRESSION_LIMIT = 500;

export type SuppressionRow = { email: string; reason: SuppressionReason; source: LedgerSource; createdAt: Date };

/** Newest first, at most 500. q is a case-insensitive substring of the address; % and _ match themselves. */
export async function listSuppressions(member: Member, q?: string): Promise<SuppressionRow[]> {
  const needle = (q ?? "").trim().slice(0, 200);
  const escaped = needle.replace(/[\\%_]/g, (c) => `\\${c}`);
  return withAgency(member.agencyId, (tx) =>
    tx
      .select({
        email: suppressions.email,
        reason: suppressions.reason,
        source: suppressions.source,
        createdAt: suppressions.createdAt,
      })
      .from(suppressions)
      .where(needle ? ilike(suppressions.email, `%${escaped}%`) : undefined)
      .orderBy(desc(suppressions.createdAt), desc(suppressions.id))
      .limit(SUPPRESSION_LIMIT),
  );
}
