"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { inboxCredentials, inboxes } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { requireMember, type Member } from "@/lib/auth";
import { googleApi } from "@/lib/google/client";
import { decryptToken } from "@/lib/google/crypto";
import { can } from "@/lib/permissions";
import { syncInbox, type SyncOutcome } from "@/lib/gmail-sync/sync-inbox";

export type InboxActionResult = { ok: true } | { ok: false; error: string };

const NOT_FOUND = "Inbox not found.";
const NO_PERMISSION = "You do not have permission to manage this inbox.";
const NOT_CONNECTED = "Reconnect this inbox before making it primary.";
const FAILED = "That did not work. Try again.";
const NOT_SYNCABLE = "Reconnect this inbox before syncing it.";

/** A manual sync stops starting new pages after this long, well inside a server action's time limit. */
const SYNC_NOW_MS = 50_000;

const fail = (error: string): InboxActionResult => ({ ok: false, error });

type ManagedInbox = { id: string; userId: string; status: string };

/** The inbox (row-level security limits this to the member's agency) if the member may manage it. */
async function manageable(member: Member, inboxId: string): Promise<{ inbox: ManagedInbox } | { error: string }> {
  if (typeof inboxId !== "string" || !inboxId) return { error: NOT_FOUND };
  let row: ManagedInbox | undefined;
  try {
    [row] = await withAgency(member.agencyId, (tx) =>
      tx.select({ id: inboxes.id, userId: inboxes.userId, status: inboxes.status }).from(inboxes).where(eq(inboxes.id, inboxId)),
    );
  } catch {
    // A malformed id fails the uuid cast; it is simply not found.
    return { error: NOT_FOUND };
  }
  if (!row) return { error: NOT_FOUND };
  if (!can(member, "inbox.manage", { ownerUserId: row.userId })) return { error: NO_PERMISSION };
  return { inbox: row };
}

/** Revokes at Google (best effort), deletes the stored credential and marks the inbox disconnected. The row stays: the ledger references it. */
export async function disconnectInbox(inboxId: string): Promise<InboxActionResult> {
  const member = await requireMember();
  const found = await manageable(member, inboxId);
  if ("error" in found) return fail(found.error);

  const [cred] = await withAgency(member.agencyId, (tx) =>
    tx.select({ enc: inboxCredentials.refreshTokenEnc }).from(inboxCredentials).where(eq(inboxCredentials.inboxId, inboxId)),
  );
  if (cred) {
    try {
      await googleApi().revoke(decryptToken(cred.enc));
    } catch {
      // Best effort. The credential is deleted below either way.
      console.warn("Gmail revoke failed during disconnect");
    }
  }

  try {
    await withAgency(member.agencyId, async (tx) => {
      await tx.delete(inboxCredentials).where(eq(inboxCredentials.inboxId, inboxId));
      await tx.update(inboxes).set({ status: "disconnected", isPrimary: false, updatedAt: new Date() }).where(eq(inboxes.id, inboxId));
    });
  } catch {
    return fail(FAILED);
  }
  revalidatePath("/settings");
  return { ok: true };
}

/** Makes the inbox its owner's primary inbox, clearing primary on the owner's other inboxes in the same transaction. */
export async function setPrimaryInbox(inboxId: string): Promise<InboxActionResult> {
  const member = await requireMember();
  const found = await manageable(member, inboxId);
  if ("error" in found) return fail(found.error);
  if (found.inbox.status === "disconnected") return fail(NOT_CONNECTED);

  try {
    await withAgency(member.agencyId, async (tx) => {
      await tx.update(inboxes).set({ isPrimary: false }).where(and(eq(inboxes.userId, found.inbox.userId), ne(inboxes.id, inboxId)));
      await tx.update(inboxes).set({ isPrimary: true }).where(eq(inboxes.id, inboxId));
    });
  } catch {
    return fail(FAILED);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export type SyncNowResult = { ok: true; outcome: SyncOutcome } | { ok: false; error: string };

/** Runs one sync of the inbox now, for up to 50 seconds. A partial run (outcome "more") is finished by the cron. */
export async function syncInboxNow(inboxId: string): Promise<SyncNowResult> {
  const member = await requireMember();
  const found = await manageable(member, inboxId);
  if ("error" in found) return { ok: false, error: found.error };
  if (found.inbox.status !== "connected") return { ok: false, error: NOT_SYNCABLE };

  let outcome: SyncOutcome;
  try {
    outcome = await syncInbox(member.agencyId, inboxId, Date.now() + SYNC_NOW_MS);
  } catch {
    return { ok: false, error: FAILED };
  }
  revalidatePath("/settings");
  return { ok: true, outcome };
}
