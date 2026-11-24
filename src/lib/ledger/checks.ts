import { and, desc, eq, gte, inArray, max } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { companies, companyDomains, doNotContact, ledgerEvents, suppressions, type SuppressionReason } from "@/db/schema";
import { matchesDoNotContact, normalizeDomain, normalizeEmail } from "./normalize";

// All checks rely on row-level security for agency scoping; tx must come from withAgency.

export async function suppressionFor(tx: Tx, email: string): Promise<{ reason: SuppressionReason; createdAt: Date } | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const [row] = await tx
    .select({ reason: suppressions.reason, createdAt: suppressions.createdAt })
    .from(suppressions)
    .where(eq(suppressions.email, normalized))
    .limit(1);
  return row ?? null;
}

/** Latest sent, follow-up sent or received event for the address. */
export async function lastContactAt(tx: Tx, email: string): Promise<Date | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const [row] = await tx
    .select({ at: max(ledgerEvents.occurredAt) })
    .from(ledgerEvents)
    .where(and(eq(ledgerEvents.email, normalized), inArray(ledgerEvents.type, ["sent", "follow_up_sent", "received"])));
  return row?.at ?? null;
}

/** Outreach to a company by its domain: who was emailed since the date, last decline, client flag. */
export async function companyActivity(
  tx: Tx,
  domain: string,
  since: Date,
): Promise<{ companyId: string | null; contactedEmails: string[]; declinedAt: Date | null; isClient: boolean }> {
  const normalized = normalizeDomain(domain);
  const none = { companyId: null, contactedEmails: [], declinedAt: null, isClient: false };
  if (!normalized) return none;
  const [company] = await tx
    .select({ id: companies.id, isClient: companies.isClient })
    .from(companyDomains)
    .innerJoin(companies, eq(companies.id, companyDomains.companyId))
    .where(eq(companyDomains.domain, normalized))
    .limit(1);
  if (!company) return none;
  const contacted = await tx
    .selectDistinct({ email: ledgerEvents.email })
    .from(ledgerEvents)
    .where(
      and(
        eq(ledgerEvents.companyId, company.id),
        inArray(ledgerEvents.type, ["sent", "follow_up_sent"]),
        gte(ledgerEvents.occurredAt, since),
      ),
    )
    .orderBy(ledgerEvents.email);
  const [declined] = await tx
    .select({ at: ledgerEvents.occurredAt })
    .from(ledgerEvents)
    .where(and(eq(ledgerEvents.companyId, company.id), eq(ledgerEvents.type, "replied_declined")))
    .orderBy(desc(ledgerEvents.occurredAt))
    .limit(1);
  return {
    companyId: company.id,
    contactedEmails: contacted.map((r) => r.email).filter((e): e is string => !!e),
    declinedAt: declined?.at ?? null,
    isClient: company.isClient,
  };
}

/** First do-not-contact entry matching the domain (or subdomain) or the name or an alias. */
export async function doNotContactMatch(
  tx: Tx,
  target: { domain?: string | null; name?: string | null },
): Promise<{ id: string; name: string } | null> {
  const entries = await tx.select().from(doNotContact);
  const hit = entries.find((e) => matchesDoNotContact(e, target));
  return hit ? { id: hit.id, name: hit.name } : null;
}
