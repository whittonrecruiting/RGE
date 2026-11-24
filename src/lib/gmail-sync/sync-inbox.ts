// Syncs one Gmail inbox into the ledger: backfill (sent, then received), then the history feed.
// Every page is fetched outside any transaction, then recorded with its cursor in one short
// withAgency transaction, so a sync can stop at any page boundary and resume without duplicates.

import { and, eq, isNull } from "drizzle-orm";
import { inboxCredentials, inboxes } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { GoogleApiError, GoogleAuthError, googleApi, type GmailMeta, type GoogleApi } from "@/lib/google/client";
import { decryptToken } from "@/lib/google/crypto";
import { ownAddresses, ownDomains, recordEvents, type LedgerInput } from "@/lib/ledger/record";
import { messageToInputs } from "./parse";

export type SyncOutcome = { status: "done" | "more" | "needs_reconnect" | "error"; inserted: number; error?: string };

/** Saved in inboxes.backfill_cursor while the backfill runs. */
export type BackfillCursor = { phase: "sent" | "received"; pageToken?: string };

const METADATA_CONCURRENCY = 5;
const ERROR_MAX = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Gmail search bound in epoch seconds: exact, with no time-zone interpretation of a date. */
const gmailAfter = (d: Date) => `after:${Math.floor(d.getTime() / 1000)}`;

/** Fixed text stored for any failure that does not come from the Google client (it could carry query data). */
const GENERIC_ERROR = "Sync failed.";

/** Only the Google client's own errors carry a message safe to store; everything else is generic. */
const safeMessage = (e: unknown) => (e instanceof GoogleApiError && e.message ? e.message : GENERIC_ERROR).slice(0, ERROR_MAX);

const backfillQuery = (phase: BackfillCursor["phase"], from: Date) =>
  phase === "sent" ? `in:sent ${gmailAfter(from)}` : `-in:sent -in:chats -in:drafts ${gmailAfter(from)}`;

function asCursor(v: unknown): BackfillCursor {
  if (v && typeof v === "object") {
    const c = v as Record<string, unknown>;
    if (c.phase === "sent" || c.phase === "received") {
      return typeof c.pageToken === "string" && c.pageToken ? { phase: c.phase, pageToken: c.pageToken } : { phase: c.phase };
    }
  }
  return { phase: "sent" };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const isStatus = (e: unknown, status: number) => e instanceof GoogleApiError && e.status === status;

type InboxState = {
  id: string;
  userId: string;
  email: string;
  status: string;
  backfillFrom: Date;
  backfillCursor: unknown;
  backfillDoneAt: Date | null;
  historyId: string | null;
  lastSyncedAt: Date | null;
  refreshTokenEnc: string | null;
  ownDomains: string[];
  ownAddresses: string[];
};

async function loadInbox(agencyId: string, inboxId: string): Promise<InboxState | undefined> {
  return withAgency(agencyId, async (tx) => {
    const [row] = await tx
      .select({
        id: inboxes.id,
        userId: inboxes.userId,
        email: inboxes.email,
        status: inboxes.status,
        backfillFrom: inboxes.backfillFrom,
        backfillCursor: inboxes.backfillCursor,
        backfillDoneAt: inboxes.backfillDoneAt,
        historyId: inboxes.historyId,
        lastSyncedAt: inboxes.lastSyncedAt,
        refreshTokenEnc: inboxCredentials.refreshTokenEnc,
      })
      .from(inboxes)
      .leftJoin(inboxCredentials, eq(inboxCredentials.inboxId, inboxes.id))
      .where(eq(inboxes.id, inboxId));
    if (!row) return undefined;
    return { ...row, ownDomains: await ownDomains(tx), ownAddresses: await ownAddresses(tx) };
  });
}

/**
 * Syncs one inbox until done or until deadline (epoch ms). The deadline is checked before each
 * page; a page already started always finishes and is saved.
 */
export async function syncInbox(agencyId: string, inboxId: string, deadline: number, api: GoogleApi = googleApi()): Promise<SyncOutcome> {
  let inbox: InboxState | undefined;
  try {
    inbox = await loadInbox(agencyId, inboxId);
  } catch {
    // A database failure, not a missing inbox. Its text could carry query data, so it is not passed on.
    console.warn("Gmail sync could not load an inbox");
    return { status: "error", inserted: 0, error: GENERIC_ERROR };
  }
  if (!inbox) return { status: "error", inserted: 0, error: "Inbox not found." };
  if (inbox.status === "needs_reconnect") return { status: "needs_reconnect", inserted: 0 };
  if (inbox.status !== "connected" || !inbox.refreshTokenEnc) return { status: "error", inserted: 0, error: "Inbox is not connected." };

  const state = inbox;
  let inserted = 0;
  const expired = () => Date.now() > deadline;

  /** Fetches metadata (skipping messages deleted since they were listed) and builds the inputs. */
  const inputsFor = async (accessToken: string, ids: string[]): Promise<LedgerInput[]> => {
    const metas = await mapLimit(ids, METADATA_CONCURRENCY, async (id): Promise<GmailMeta | null> => {
      try {
        return await api.messageMetadata(accessToken, id);
      } catch (e) {
        if (isStatus(e, 404)) return null;
        throw e;
      }
    });
    const ctx = { inboxId: state.id, inboxEmail: state.email, userId: state.userId, ownDomains: state.ownDomains, ownAddresses: state.ownAddresses };
    return metas.flatMap((m) => (m ? messageToInputs(m, ctx) : []));
  };

  /** Records one page and applies the inbox update in one transaction. */
  const savePage = async (inputs: LedgerInput[], set: Partial<typeof inboxes.$inferInsert>) => {
    const r = await withAgency(agencyId, async (tx) => {
      const res = await recordEvents(tx, agencyId, inputs, { ownDomains: state.ownDomains });
      await tx.update(inboxes).set({ ...set, lastSyncError: null, updatedAt: new Date() }).where(eq(inboxes.id, state.id));
      return res;
    });
    inserted += r.inserted;
  };

  /**
   * The history feed expired: re-list all mail since a day before the last sync, then restart
   * the feed from the current history id (captured first, so nothing between is missed).
   * last_synced_at moves only when the re-list completes, so an interrupted re-list repeats
   * from the same date.
   */
  const relist = async (accessToken: string): Promise<SyncOutcome> => {
    const { historyId } = await api.profile(accessToken);
    const since = new Date((state.lastSyncedAt ?? state.backfillFrom).getTime() - DAY_MS);
    const q = `-in:chats -in:drafts ${gmailAfter(since)}`;
    let token: string | undefined;
    for (;;) {
      if (expired()) return { status: "more", inserted };
      const listed = await api.listMessageIds(accessToken, q, token);
      const inputs = await inputsFor(accessToken, listed.ids);
      await savePage(inputs, listed.nextPageToken ? {} : { historyId, lastSyncedAt: new Date() });
      if (!listed.nextPageToken) return { status: "done", inserted };
      token = listed.nextPageToken;
    }
  };

  try {
    const accessToken = await api.accessToken(decryptToken(state.refreshTokenEnc!));

    // 1 and 2: backfill, sent then received.
    if (!state.backfillDoneAt) {
      let cursor = asCursor(state.backfillCursor);
      let capturedHistory = state.historyId !== null;
      for (;;) {
        if (expired()) return { status: "more", inserted };
        if (!capturedHistory) {
          // Mail arriving during the backfill is picked up by the history phase from this point.
          const { historyId } = await api.profile(accessToken);
          await withAgency(agencyId, (tx) =>
            tx.update(inboxes).set({ historyId }).where(and(eq(inboxes.id, state.id), isNull(inboxes.historyId))),
          );
          state.historyId ??= historyId;
          capturedHistory = true;
        }
        let listed: Awaited<ReturnType<GoogleApi["listMessageIds"]>>;
        try {
          listed = await api.listMessageIds(accessToken, backfillQuery(cursor.phase, state.backfillFrom), cursor.pageToken);
        } catch (e) {
          // Gmail rejected a saved page token (stale or invalid): restart this phase instead of
          // failing on it forever. Dedupe keys make the replayed pages harmless.
          if (!(isStatus(e, 400) && cursor.pageToken)) throw e;
          const restart: BackfillCursor = { phase: cursor.phase };
          cursor = restart;
          await withAgency(agencyId, (tx) =>
            tx.update(inboxes).set({ backfillCursor: restart, lastSyncError: safeMessage(e), updatedAt: new Date() }).where(eq(inboxes.id, state.id)),
          );
          continue;
        }
        const inputs = await inputsFor(accessToken, listed.ids);
        const done = !listed.nextPageToken && cursor.phase === "received";
        const nextCursor: BackfillCursor | null = listed.nextPageToken
          ? { phase: cursor.phase, pageToken: listed.nextPageToken }
          : cursor.phase === "sent"
            ? { phase: "received" }
            : null;
        const now = new Date();
        await savePage(inputs, { backfillCursor: nextCursor, lastSyncedAt: now, ...(done ? { backfillDoneAt: now } : {}) });
        state.lastSyncedAt = now;
        if (done) break;
        cursor = nextCursor!;
      }
    }

    // 3: history since the saved history id.
    if (!state.historyId) {
      // Backfill finished without a history id (should not happen): start the feed from now.
      const { historyId } = await api.profile(accessToken);
      await savePage([], { historyId, lastSyncedAt: new Date() });
      return { status: "done", inserted };
    }
    let pageToken: string | undefined;
    for (;;) {
      if (expired()) return { status: "more", inserted };
      const res = await api.history(accessToken, state.historyId, pageToken);
      if (res === "expired") return await relist(accessToken);
      const inputs = await inputsFor(accessToken, res.messageIds);
      // The history id only advances after the last page, so an interrupted feed is replayed (dedupe keeps it idempotent).
      await savePage(inputs, { lastSyncedAt: new Date(), ...(res.nextPageToken ? {} : { historyId: res.historyId }) });
      if (!res.nextPageToken) return { status: "done", inserted };
      pageToken = res.nextPageToken;
    }
  } catch (e) {
    if (e instanceof GoogleAuthError) {
      // Keep the cursor and history id: a reconnect resumes where this stopped.
      await withAgency(agencyId, (tx) =>
        tx.update(inboxes).set({ status: "needs_reconnect", updatedAt: new Date() }).where(and(eq(inboxes.id, state.id), eq(inboxes.status, "connected"))),
      );
      return { status: "needs_reconnect", inserted };
    }
    const message = safeMessage(e);
    if (!(e instanceof GoogleApiError)) console.warn("Gmail sync failed with a non-Google error");
    try {
      await withAgency(agencyId, (tx) => tx.update(inboxes).set({ lastSyncError: message }).where(eq(inboxes.id, state.id)));
    } catch {
      // The outcome still reports the error.
    }
    return { status: "error", inserted, error: message };
  }

}
