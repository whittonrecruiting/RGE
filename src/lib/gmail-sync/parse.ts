// Pure: turns one Gmail message's metadata into ledger inputs. No database or network.
// The subject header is read only to recognize bounce notices; it is never put into an input.

import type { GmailMeta } from "@/lib/google/client";
import type { LedgerInput } from "@/lib/ledger/record";
import { domainOf, isFreemail, normalizeEmail, parseAddressList } from "@/lib/ledger/normalize";

export type MessageContext = {
  inboxId: string;
  inboxEmail: string;
  userId: string;
  /** The agency's inbox domains. Free-mail domains in it are ignored. */
  ownDomains: string[];
  /** Exact addresses of the agency's other inboxes, own even on a free-mail domain. */
  ownAddresses?: string[];
};

/** Labels whose messages are never outreach or replies. */
const SKIP_LABELS = new Set(["DRAFT", "SPAM", "CHAT"]);
const DAEMON = /^(mailer-daemon|postmaster)@/;
const FAILURE_SUBJECT = /delivery status notification \(failure\)|undeliverable/i;
const BULK_PRECEDENCE = new Set(["bulk", "list", "junk"]);

export function messageToInputs(m: GmailMeta, ctx: MessageContext): LedgerInput[] {
  if (m.labelIds.some((l) => SKIP_LABELS.has(l))) return [];
  const inboxEmail = normalizeEmail(ctx.inboxEmail);
  // Own means a non-free-mail agency domain, or exactly one of the agency's inbox addresses.
  // A whole free-mail domain is never own: candidates use personal (often gmail.com) addresses.
  const ownDomainSet = new Set(
    [...ctx.ownDomains, inboxEmail ? domainOf(inboxEmail) : ""].map((d) => d.trim().toLowerCase()).filter((d) => d && !isFreemail(d)),
  );
  const ownAddressSet = new Set(
    [...(ctx.ownAddresses ?? []), ctx.inboxEmail].map((e) => normalizeEmail(e)).filter((e): e is string => e !== null),
  );
  const isOwn = (email: string) => ownAddressSet.has(email) || ownDomainSet.has(domainOf(email));
  const h = m.headers;
  const base = {
    occurredAt: new Date(m.internalDate),
    source: "gmail" as const,
    inboxId: ctx.inboxId,
    userId: ctx.userId,
    gmailMessageId: m.id,
    gmailThreadId: m.threadId || null,
  };
  const key = (suffix: string) => `gmail:${ctx.inboxId}:${m.id}:${suffix}`;

  if (m.labelIds.includes("SENT")) {
    const seen = new Set<string>();
    const out: LedgerInput[] = [];
    for (const header of [h.to, h.cc, h.bcc]) {
      for (const r of parseAddressList(header ?? "")) {
        if (seen.has(r.email) || isOwn(r.email)) continue;
        seen.add(r.email);
        out.push({ ...base, type: "sent", email: r.email, name: r.name, dedupeKey: key(r.email) });
      }
    }
    return out;
  }

  const from = parseAddressList(h.from ?? "")[0];
  if (!from) return [];

  if (DAEMON.test(from.email)) {
    // Only a failure notice that names the failed recipients counts. Delay and other notices give nothing.
    const failed = h["x-failed-recipients"];
    if (!failed || !FAILURE_SUBJECT.test(h.subject ?? "")) return [];
    const seen = new Set<string>();
    const out: LedgerInput[] = [];
    for (const r of parseAddressList(failed)) {
      if (seen.has(r.email)) continue;
      seen.add(r.email);
      out.push({ ...base, type: "bounced", email: r.email, dedupeKey: key(`bounce:${r.email}`) });
    }
    return out;
  }

  if (isOwn(from.email)) return [];
  if (h["list-unsubscribe"] !== undefined) return [];
  if (BULK_PRECEDENCE.has((h.precedence ?? "").trim().toLowerCase())) return [];
  const auto = h["auto-submitted"];
  if (auto !== undefined && auto.trim().toLowerCase() !== "no") return [];

  return [{ ...base, type: "received", email: from.email, name: from.name, dedupeKey: key("from") }];
}
