// Server only. Deliberately NOT a "use server" module: completeConnection must never be callable
// from the client. Only the OAuth callback route calls it, after verifying state and nonce.

import { and, eq, ne } from "drizzle-orm";
import { inboxCredentials, inboxes } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import type { Member } from "@/lib/auth";
import { GMAIL_SCOPES, googleApi } from "@/lib/google/client";
import { encryptToken } from "@/lib/google/crypto";
import { domainOf, normalizeEmail } from "@/lib/ledger/normalize";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings/get";
import { checkDomain, type DomainCheck } from "./domain-check";

export type ConnectResult = { ok: true; inboxId: string } | { ok: false; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_BACKFILL_DAYS = 365;

export const CONNECT_ERRORS = {
  noPermission: "You do not have permission to connect an inbox.",
  exchange: "Google could not complete the connection. Try again.",
  scopes: "Gmail did not grant every permission RGE needs. Connect again and allow all permissions.",
  profile: "Google did not return the inbox address. Try again.",
  teammate: "This inbox is already connected by a teammate.",
  save: "The inbox could not be saved. Try again.",
} as const;

/** Logs the failed step only. Never the error itself: it can carry codes, tokens or addresses. */
const logStep = (step: string) => console.warn(`Gmail connect failed at step: ${step}`);

/** Best effort: a token we will not store should not stay valid at Google. */
async function revokeQuietly(refreshToken: string): Promise<void> {
  try {
    await googleApi().revoke(refreshToken);
  } catch {
    logStep("revoke after failure");
  }
}

/**
 * Exchanges the OAuth code and saves the inbox for member. All Google and DNS calls happen first;
 * the database writes then happen in one short transaction.
 */
export async function completeConnection(member: Member, code: string, redirectUri: string, now = new Date()): Promise<ConnectResult> {
  if (!can(member, "inbox.connect")) return { ok: false, error: CONNECT_ERRORS.noPermission };
  const api = googleApi();

  let tokens: { refreshToken: string; accessToken: string; scopes: string[] };
  try {
    tokens = await api.exchangeCode(code, redirectUri);
  } catch {
    logStep("code exchange");
    return { ok: false, error: CONNECT_ERRORS.exchange };
  }
  const fail = async (error: string, revoke = true): Promise<ConnectResult> => {
    if (revoke) await revokeQuietly(tokens.refreshToken);
    return { ok: false, error };
  };

  if (!GMAIL_SCOPES.every((s) => tokens.scopes.includes(s))) return fail(CONNECT_ERRORS.scopes);

  let email: string | null;
  try {
    email = normalizeEmail((await api.profile(tokens.accessToken)).emailAddress);
  } catch {
    logStep("profile");
    return fail(CONNECT_ERRORS.profile);
  }
  if (!email) return fail(CONNECT_ERRORS.profile);
  const address = email;

  // Signature and domain checks are informational: a failure here does not block the connection.
  let signature: string | null = null;
  try {
    signature = await api.sendAsSignature(tokens.accessToken, address);
  } catch {
    logStep("signature");
  }
  let domainCheck: DomainCheck | null = null;
  try {
    domainCheck = await checkDomain(domainOf(address));
  } catch {
    logStep("domain check");
  }

  let refreshTokenEnc: string;
  let backfillFrom: Date;
  try {
    refreshTokenEnc = encryptToken(tokens.refreshToken);
    const { repeatWindowDays } = await getSettings(member.agencyId);
    backfillFrom = new Date(now.getTime() - Math.max(MIN_BACKFILL_DAYS, repeatWindowDays) * DAY_MS);
  } catch {
    logStep("prepare");
    return fail(CONNECT_ERRORS.save);
  }

  type Outcome = { inboxId: string } | { teammate: true };
  let outcome: Outcome;
  try {
    outcome = await withAgency(member.agencyId, async (tx): Promise<Outcome> => {
      const [existing] = await tx
        .select({ id: inboxes.id, userId: inboxes.userId })
        .from(inboxes)
        .where(and(eq(inboxes.agencyId, member.agencyId), eq(inboxes.email, address)));
      if (existing && existing.userId !== member.userId) return { teammate: true };

      const fresh = { status: "connected" as const, signatureHtml: signature, lastSyncError: null, updatedAt: now };
      const checked = domainCheck ? { domainCheck, domainCheckedAt: now } : {};
      let inboxId: string;
      if (existing) {
        // Reconnect: keep backfill_from, the backfill cursor and the history id so sync resumes.
        await tx.update(inboxes).set({ ...fresh, ...checked }).where(eq(inboxes.id, existing.id));
        inboxId = existing.id;
      } else {
        const [row] = await tx
          .insert(inboxes)
          .values({ agencyId: member.agencyId, userId: member.userId, email: address, backfillFrom, ...fresh, ...checked })
          .returning({ id: inboxes.id });
        inboxId = row.id;
      }

      await tx
        .insert(inboxCredentials)
        .values({ agencyId: member.agencyId, inboxId, refreshTokenEnc, scopes: tokens.scopes, updatedAt: now })
        .onConflictDoUpdate({ target: inboxCredentials.inboxId, set: { refreshTokenEnc, scopes: tokens.scopes, updatedAt: now } });

      const [primary] = await tx
        .select({ id: inboxes.id })
        .from(inboxes)
        .where(and(eq(inboxes.userId, member.userId), eq(inboxes.isPrimary, true), ne(inboxes.status, "disconnected")))
        .limit(1);
      if (!primary) {
        await tx.update(inboxes).set({ isPrimary: false }).where(and(eq(inboxes.userId, member.userId), ne(inboxes.id, inboxId)));
        await tx.update(inboxes).set({ isPrimary: true }).where(eq(inboxes.id, inboxId));
      }
      return { inboxId };
    });
  } catch {
    logStep("save");
    return fail(CONNECT_ERRORS.save);
  }

  // Google issues one grant per account and app, so revoking here would also end the teammate's
  // working connection to the same mailbox. The unused token is left to expire with that grant.
  if ("teammate" in outcome) return fail(CONNECT_ERRORS.teammate, false);
  return { ok: true, inboxId: outcome.inboxId };
}
