import { asc, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { doNotContact, type DncSource } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import type { Member } from "@/lib/auth";
import { normalizeCompanyName, normalizeDomain } from "@/lib/ledger/normalize";
import type { DncInput } from "./csv";

export type DncEntry = { id: string; name: string; domains: string[]; aliases: string[]; source: DncSource };

/** Entries in name order. Row-level security limits this to the member's agency. */
export async function listDnc(member: Member): Promise<DncEntry[]> {
  const rows = await withAgency(member.agencyId, (tx) =>
    tx
      .select({
        id: doNotContact.id,
        name: doNotContact.name,
        domains: doNotContact.domains,
        aliases: doNotContact.aliases,
        source: doNotContact.source,
      })
      .from(doNotContact)
      .orderBy(asc(doNotContact.name), asc(doNotContact.createdAt)),
  );
  return rows;
}

type Working = {
  id: string | null;
  name: string;
  domains: string[];
  aliases: string[];
  note: string | null;
  dirty: boolean;
};

/** Appends the values that are not already there, keeping order. Keys decide what counts as the same. */
function mergeInto(target: string[], incoming: string[], key: (v: string) => string): boolean {
  let changed = false;
  const seen = new Set(target.map(key));
  for (const value of incoming) {
    const k = key(value);
    if (seen.has(k)) continue;
    seen.add(k);
    target.push(value);
    changed = true;
  }
  return changed;
}

/**
 * Adds entries. A row whose normalized company name equals an existing entry's (or an earlier row's
 * in the same batch) merges its domains and aliases into that entry instead of duplicating it.
 * tx must come from withAgency.
 */
export async function upsertDncEntries(
  tx: Tx,
  agencyId: string,
  rows: DncInput[],
  source: DncSource,
  createdBy: string,
): Promise<{ added: number; merged: number }> {
  const existing = await tx.select().from(doNotContact).orderBy(asc(doNotContact.createdAt), asc(doNotContact.id));
  const byName = new Map<string, Working>();
  for (const e of existing) {
    const key = normalizeCompanyName(e.name);
    if (!byName.has(key)) {
      byName.set(key, { id: e.id, name: e.name, domains: [...e.domains], aliases: [...e.aliases], note: e.note, dirty: false });
    }
  }

  const created: Working[] = [];
  let merged = 0;
  for (const row of rows) {
    const key = normalizeCompanyName(row.name);
    const domains = row.domains.map((d) => normalizeDomain(d)).filter((d): d is string => d !== null);
    const hit = byName.get(key);
    if (hit) {
      const a = mergeInto(hit.domains, domains, (v) => v);
      const b = mergeInto(hit.aliases, row.aliases, normalizeCompanyName);
      if (!hit.note && row.note) {
        hit.note = row.note;
        hit.dirty = true;
      }
      if (a || b) hit.dirty = true;
      merged++;
    } else {
      const entry: Working = { id: null, name: row.name, domains: [], aliases: [], note: row.note ?? null, dirty: true };
      mergeInto(entry.domains, domains, (v) => v);
      mergeInto(entry.aliases, row.aliases, normalizeCompanyName);
      byName.set(key, entry);
      created.push(entry);
    }
  }

  for (const entry of byName.values()) {
    if (entry.id && entry.dirty) {
      await tx
        .update(doNotContact)
        .set({ domains: entry.domains, aliases: entry.aliases, note: entry.note, updatedAt: new Date() })
        .where(eq(doNotContact.id, entry.id));
    }
  }
  if (created.length > 0) {
    await tx.insert(doNotContact).values(
      created.map((e) => ({
        agencyId,
        name: e.name,
        domains: e.domains,
        aliases: e.aliases,
        source,
        note: e.note,
        createdBy,
      })),
    );
  }
  return { added: created.length, merged };
}
