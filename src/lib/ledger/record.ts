import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  companies,
  companyDomains,
  contacts,
  inboxes,
  ledgerEvents,
  suppressions,
  type LedgerEventType,
  type LedgerSource,
  type SuppressionReason,
} from "@/db/schema";
import { domainOf, isFreemail, normalizeCompanyName, normalizeEmail } from "./normalize";

export type LedgerInput = {
  type: LedgerEventType;
  email?: string | null;
  name?: string | null;
  companyName?: string | null;
  occurredAt: Date;
  source: LedgerSource;
  dedupeKey: string;
  inboxId?: string | null;
  userId?: string | null;
  mpcId?: string | null;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  note?: string | null;
};

/** Distinct, normalized email domains of the agency's inboxes (any status). */
export async function ownDomains(tx: Tx): Promise<string[]> {
  const rows = await tx.select({ email: inboxes.email }).from(inboxes);
  const domains = new Set<string>();
  for (const r of rows) {
    const email = normalizeEmail(r.email);
    if (email) domains.add(domainOf(email));
  }
  return [...domains];
}

/**
 * Inserts a suppression. Suppressions are permanent (the app role has no UPDATE or DELETE),
 * so a repeat insert is a no-op reported as "already". Throws Error("Invalid email address")
 * when the address does not normalize to one valid address; callers must pass a real address.
 */
export async function addSuppression(
  tx: Tx,
  agencyId: string,
  s: { email: string; reason: SuppressionReason; source: LedgerSource; note?: string | null; createdBy?: string | null },
): Promise<"added" | "already"> {
  const email = normalizeEmail(s.email);
  if (!email) throw new Error("Invalid email address");
  const rows = await tx
    .insert(suppressions)
    .values({
      agencyId,
      email,
      reason: s.reason,
      source: s.source,
      note: s.note ?? null,
      createdBy: s.createdBy ?? null,
    })
    .onConflictDoNothing({ target: [suppressions.agencyId, suppressions.email] })
    .returning({ id: suppressions.id });
  return rows.length > 0 ? "added" : "already";
}

async function companyForDomain(tx: Tx, agencyId: string, domain: string, name: string | null): Promise<string> {
  const find = async () => {
    const [row] = await tx
      .select({ companyId: companyDomains.companyId })
      .from(companyDomains)
      .where(and(eq(companyDomains.agencyId, agencyId), eq(companyDomains.domain, domain)));
    return row?.companyId;
  };
  const existing = await find();
  if (existing) return existing;
  const [company] = await tx
    .insert(companies)
    .values({ agencyId, name: name?.trim() || domain })
    .returning({ id: companies.id });
  const inserted = await tx
    .insert(companyDomains)
    .values({ agencyId, companyId: company!.id, domain })
    .onConflictDoNothing({ target: [companyDomains.agencyId, companyDomains.domain] })
    .returning({ id: companyDomains.id });
  if (inserted.length > 0) return company!.id;
  return (await find()) ?? company!.id;
}

async function companyForName(tx: Tx, agencyId: string, name: string): Promise<string> {
  const wanted = normalizeCompanyName(name);
  const rows = await tx.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.agencyId, agencyId));
  const match = rows.find((r) => normalizeCompanyName(r.name) === wanted);
  if (match) return match.id;
  const [created] = await tx.insert(companies).values({ agencyId, name: name.trim() }).returning({ id: companies.id });
  return created!.id;
}

/**
 * Writes events into the ledger inside the caller's transaction (tx must come from withAgency).
 * `inserted` counts new event rows; inputs skipped for an invalid address or a duplicate
 * dedupe key count as skipped.
 */
export async function recordEvents(
  tx: Tx,
  agencyId: string,
  inputs: LedgerInput[],
  opts: { ownDomains: string[] },
): Promise<{ inserted: number; skipped: number }> {
  const own = new Set(opts.ownDomains.map((d) => d.trim().toLowerCase()));
  let inserted = 0;
  let skipped = 0;
  for (const input of inputs) {
    const email = input.email ? normalizeEmail(input.email) : null;
    const companyName = input.companyName?.trim() || null;
    if (!email && !(input.type === "agreement_signed" && companyName)) {
      skipped++;
      continue;
    }

    let domain: string | null = null;
    let companyId: string | null = null;
    let contactId: string | null = null;
    if (email) {
      domain = domainOf(email);
      if (!isFreemail(domain) && !own.has(domain)) {
        companyId = await companyForDomain(tx, agencyId, domain, companyName);
      }
      const [contact] = await tx
        .insert(contacts)
        .values({ agencyId, email, companyId, name: input.name?.trim() || null })
        .onConflictDoUpdate({
          target: [contacts.agencyId, contacts.email],
          set: {
            name: sql`coalesce(${contacts.name}, excluded.name)`,
            companyId: sql`coalesce(${contacts.companyId}, excluded.company_id)`,
          },
          setWhere: sql`${contacts.name} is null or ${contacts.companyId} is null`,
        })
        .returning({ id: contacts.id });
      // The conditional update returns no row when nothing needed filling in.
      contactId =
        contact?.id ??
        (await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.agencyId, agencyId), eq(contacts.email, email))))[0]!.id;
    }
    if (!companyId && companyName && input.type === "agreement_signed") {
      companyId = await companyForName(tx, agencyId, companyName);
    }

    const rows = await tx
      .insert(ledgerEvents)
      .values({
        agencyId,
        type: input.type,
        email,
        domain,
        contactId,
        companyId,
        mpcId: input.mpcId ?? null,
        userId: input.userId ?? null,
        inboxId: input.inboxId ?? null,
        gmailMessageId: input.gmailMessageId ?? null,
        gmailThreadId: input.gmailThreadId ?? null,
        occurredAt: input.occurredAt,
        source: input.source,
        dedupeKey: input.dedupeKey,
        note: input.note ?? null,
      })
      .onConflictDoNothing({ target: [ledgerEvents.agencyId, ledgerEvents.dedupeKey] })
      .returning({ id: ledgerEvents.id });
    if (rows.length > 0) inserted++;
    else skipped++;

    if ((input.type === "opted_out" || input.type === "bounced") && email) {
      await addSuppression(tx, agencyId, {
        email,
        reason: input.type,
        source: input.source,
        note: input.note ?? null,
        createdBy: input.userId ?? null,
      });
    }
    if (input.type === "agreement_signed" && companyId) {
      await tx.update(companies).set({ isClient: true }).where(and(eq(companies.agencyId, agencyId), eq(companies.id, companyId)));
    }
  }
  return { inserted, skipped };
}
