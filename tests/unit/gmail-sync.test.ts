import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { agencies, inboxCredentials, inboxes, ledgerEvents, suppressions } from "@/db/schema";
import { GoogleAuthError, setTestGoogleApi, type GmailMeta, type GoogleApi } from "@/lib/google/client";
import { encryptToken } from "@/lib/google/crypto";
import { syncInbox } from "@/lib/gmail-sync/sync-inbox";
import { runSyncTick } from "@/lib/gmail-sync/tick";
import { syncInboxNow } from "@/lib/inboxes/actions";
import { GET as cronGet } from "@/app/api/cron/gmail-sync/route";
import { asOwner, createTestDb, seedAgencies, type TestDb } from "../helpers/test-db";
import { asMember, membersOf, type MemberFixtures } from "../helpers/as-member";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const BACKFILL_FROM = new Date("2025-11-24T00:00:00Z");
const FAR = () => Date.now() + 60_000;

let db: TestDb;
let close: (() => Promise<void>) | undefined;
let f: MemberFixtures;
const savedKey = process.env.RGE_TOKEN_KEY;
const savedCron = process.env.CRON_SECRET;

type Fake = GoogleApi & {
  calls: { lists: string[]; history: string[]; meta: number };
  messages: Map<string, GmailMeta>;
  sent: string[];
  received: string[];
  relist: string[];
  historyReply: Awaited<ReturnType<GoogleApi["history"]>>;
  profileHistoryId: string;
  onList?: () => void;
  authFails: boolean;
};

const at = (i: number) => Date.parse("2026-06-01T12:00:00Z") + i * 60_000;

function sentMeta(id: string, i: number): GmailMeta {
  return {
    id,
    threadId: `t-${id}`,
    internalDate: at(i),
    labelIds: ["SENT"],
    headers: { from: "pat@example.com", to: `Person ${i} <person${i}@example.org>`, cc: "sam@example.com", subject: "Hello" },
  };
}
function receivedMeta(id: string, i: number): GmailMeta {
  return { id, threadId: `t-${id}`, internalDate: at(i), labelIds: ["INBOX"], headers: { from: `Sender ${i} <sender${i}@example.net>`, to: "pat@example.com" } };
}

function page(ids: string[], pageToken?: string) {
  const start = pageToken ? Number(pageToken) : 0;
  const end = start + 100;
  return { ids: ids.slice(start, end), nextPageToken: end < ids.length ? String(end) : undefined };
}

function makeFake(): Fake {
  const messages = new Map<string, GmailMeta>();
  const sent = Array.from({ length: 250 }, (_, i) => `s${i}`);
  const received = Array.from({ length: 30 }, (_, i) => `r${i}`);
  sent.forEach((id, i) => messages.set(id, sentMeta(id, i)));
  received.forEach((id, i) => messages.set(id, receivedMeta(id, i)));
  const nope = async () => {
    throw new Error("not used");
  };
  const fake: Fake = {
    calls: { lists: [], history: [], meta: 0 },
    messages,
    sent,
    received,
    relist: [],
    historyReply: { messageIds: [], historyId: "1000" },
    profileHistoryId: "1000",
    authFails: false,
    exchangeCode: nope,
    revoke: async () => {},
    sendAsSignature: async () => null,
    accessToken: async (refresh) => {
      if (fake.authFails) throw new GoogleAuthError("Google rejected the stored authorization (invalid_grant). Reconnect the inbox.");
      expect(refresh).toBe("1//sync-refresh");
      return "access-token";
    },
    profile: async () => ({ emailAddress: "pat@example.com", historyId: fake.profileHistoryId }),
    listMessageIds: async (_token, q, pageToken) => {
      fake.calls.lists.push(`${q}|${pageToken ?? ""}`);
      const reply = q.startsWith("in:sent")
        ? page(fake.sent, pageToken)
        : q.startsWith("-in:sent")
          ? page(fake.received, pageToken)
          : page(fake.relist, pageToken);
      fake.onList?.();
      return reply;
    },
    messageMetadata: async (_token, id) => {
      fake.calls.meta++;
      const m = fake.messages.get(id);
      if (!m) throw new Error("Google message get failed: HTTP 404 (NOT_FOUND)");
      return m;
    },
    history: async (_token, start) => {
      fake.calls.history.push(start);
      return fake.historyReply;
    },
  };
  return fake;
}

let fake: Fake;

async function seedInbox(agencyId: string, userId: string, over: Partial<typeof inboxes.$inferInsert> = {}, withCred = true) {
  return asOwner(db, async (tx) => {
    const [row] = await tx
      .insert(inboxes)
      .values({ agencyId, userId, email: "pat@example.com", backfillFrom: BACKFILL_FROM, ...over })
      .returning({ id: inboxes.id });
    if (withCred) {
      await tx.insert(inboxCredentials).values({
        agencyId,
        inboxId: row!.id,
        refreshTokenEnc: encryptToken("1//sync-refresh"),
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      });
    }
    return row!.id;
  });
}

const inboxRow = async (id: string) => (await asOwner(db, (tx) => tx.select().from(inboxes).where(eq(inboxes.id, id))))[0]!;
const events = () => asOwner(db, (tx) => tx.select().from(ledgerEvents));

beforeEach(async () => {
  process.env.RGE_TOKEN_KEY = randomBytes(32).toString("base64");
  const t = await createTestDb();
  db = t.db;
  close = t.close;
  const [agency] = await seedAgencies(db, 1);
  f = membersOf(agency!);
  fake = makeFake();
  setTestGoogleApi(fake);
});
afterEach(async () => {
  vi.restoreAllMocks();
  setTestGoogleApi(undefined);
  if (savedKey === undefined) delete process.env.RGE_TOKEN_KEY;
  else process.env.RGE_TOKEN_KEY = savedKey;
  if (savedCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedCron;
  await close?.();
  close = undefined;
});

describe("syncInbox", () => {
  test("backfill pages through sent then received and finishes with done", async () => {
    const id = await seedInbox(f.agency.id, f.recA.userId);
    const out = await syncInbox(f.agency.id, id, FAR(), fake);
    expect(out).toEqual({ status: "done", inserted: 280 });
    expect(fake.calls.lists).toEqual([
      "in:sent after:2025/11/24|",
      "in:sent after:2025/11/24|100",
      "in:sent after:2025/11/24|200",
      "-in:sent -in:chats -in:drafts after:2025/11/24|",
    ]);
    const rows = await events();
    expect(rows.filter((e) => e.type === "sent")).toHaveLength(250);
    expect(rows.filter((e) => e.type === "received")).toHaveLength(30);
    expect(rows.every((e) => e.source === "gmail" && e.inboxId === id && e.userId === f.recA.userId)).toBe(true);
    // Internal cc (own domain) is never recorded.
    expect(rows.some((e) => e.email === "sam@example.com")).toBe(false);
    const inbox = await inboxRow(id);
    expect(inbox.backfillDoneAt).not.toBeNull();
    expect(inbox.historyId).toBe("1000");
    expect(inbox.lastSyncedAt).not.toBeNull();
    expect(inbox.lastSyncError).toBeNull();
  });

  test("a deadline mid-backfill returns more, and the next call resumes without duplicates", async () => {
    const id = await seedInbox(f.agency.id, f.recA.userId);
    const deadline = Date.now() + 60_000;
    // After the first list call the clock passes the deadline: the in-flight page still finishes.
    fake.onList = () => {
      vi.spyOn(Date, "now").mockReturnValue(deadline + 1);
    };
    const first = await syncInbox(f.agency.id, id, deadline, fake);
    expect(first).toEqual({ status: "more", inserted: 100 });
    expect(fake.calls.lists).toHaveLength(1);
    expect((await inboxRow(id)).backfillCursor).toEqual({ phase: "sent", pageToken: "100" });

    vi.restoreAllMocks();
    fake.onList = undefined;
    const second = await syncInbox(f.agency.id, id, FAR(), fake);
    expect(second).toEqual({ status: "done", inserted: 180 });
    expect(fake.calls.lists[1]).toBe("in:sent after:2025/11/24|100");
    const rows = await events();
    expect(rows).toHaveLength(280);
    expect(new Set(rows.map((e) => e.dedupeKey)).size).toBe(280);

    // A third call reprocesses nothing from the backfill.
    const third = await syncInbox(f.agency.id, id, FAR(), fake);
    expect(third).toEqual({ status: "done", inserted: 0 });
    expect(await events()).toHaveLength(280);
  });

  test("no page starts after the deadline", async () => {
    const id = await seedInbox(f.agency.id, f.recA.userId);
    const out = await syncInbox(f.agency.id, id, Date.now() - 1, fake);
    expect(out).toEqual({ status: "more", inserted: 0 });
    expect(fake.calls.lists).toEqual([]);
  });

  test("history after backfill records new messages", async () => {
    const id = await seedInbox(f.agency.id, f.recA.userId);
    await syncInbox(f.agency.id, id, FAR(), fake);
    // The backfill call already read the (empty) feed from the captured history id.
    expect(fake.calls.history).toEqual(["1000"]);
    fake.calls.history = [];
    fake.messages.set("h1", receivedMeta("h1", 500));
    fake.messages.set("h2", sentMeta("h2", 501));
    fake.messages.set("h3", {
      id: "h3",
      threadId: "t-h3",
      internalDate: at(502),
      labelIds: ["INBOX"],
      headers: {
        from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
        subject: "Delivery Status Notification (Failure)",
        "x-failed-recipients": "gone@example.org",
      },
    });
    // h-deleted was removed before we fetched it: skipped, not an error.
    fake.historyReply = { messageIds: ["h1", "h2", "h3", "h-deleted"], historyId: "2000" };
    const out = await syncInbox(f.agency.id, id, FAR(), fake);
    expect(out).toEqual({ status: "done", inserted: 3 });
    expect(fake.calls.history).toEqual(["1000"]);
    expect((await inboxRow(id)).historyId).toBe("2000");
    const rows = await events();
    expect(rows).toHaveLength(283);
    expect(rows.find((e) => e.type === "bounced")?.email).toBe("gone@example.org");
    const sup = await asOwner(db, (tx) => tx.select().from(suppressions));
    expect(sup.map((s) => [s.email, s.reason])).toEqual([["gone@example.org", "bounced"]]);
  });

  test("expired history falls back to a date re-list", async () => {
    const lastSynced = new Date("2026-11-20T10:00:00Z");
    const id = await seedInbox(f.agency.id, f.recA.userId, {
      backfillDoneAt: new Date("2026-11-01T00:00:00Z"),
      historyId: "500",
      lastSyncedAt: lastSynced,
    });
    fake.historyReply = "expired";
    fake.profileHistoryId = "3000";
    fake.messages.set("x1", receivedMeta("x1", 900));
    fake.messages.set("x2", sentMeta("x2", 901));
    fake.relist = ["x1", "x2"];
    const out = await syncInbox(f.agency.id, id, FAR(), fake);
    expect(out).toEqual({ status: "done", inserted: 2 });
    expect(fake.calls.history).toEqual(["500"]);
    expect(fake.calls.lists).toEqual(["-in:chats -in:drafts after:2026/11/19|"]);
    const inbox = await inboxRow(id);
    expect(inbox.historyId).toBe("3000");
    expect(inbox.lastSyncedAt!.getTime()).toBeGreaterThan(lastSynced.getTime());
  });

  test("invalid_grant marks the inbox needs_reconnect and keeps the cursor", async () => {
    const id = await seedInbox(f.agency.id, f.recA.userId, { backfillCursor: { phase: "received", pageToken: "abc" }, historyId: "700" });
    fake.authFails = true;
    const out = await syncInbox(f.agency.id, id, FAR(), fake);
    expect(out.status).toBe("needs_reconnect");
    expect(out.inserted).toBe(0);
    const inbox = await inboxRow(id);
    expect(inbox.status).toBe("needs_reconnect");
    expect(inbox.backfillCursor).toEqual({ phase: "received", pageToken: "abc" });
    expect(inbox.historyId).toBe("700");
  });

  test("other errors store a short message and return error", async () => {
    const id = await seedInbox(f.agency.id, f.recA.userId);
    fake.listMessageIds = async () => {
      throw new Error("Google messages list failed: HTTP 403 (PERMISSION_DENIED)");
    };
    const out = await syncInbox(f.agency.id, id, FAR(), fake);
    expect(out).toEqual({ status: "error", inserted: 0, error: "Google messages list failed: HTTP 403 (PERMISSION_DENIED)" });
    const inbox = await inboxRow(id);
    expect(inbox.lastSyncError).toBe("Google messages list failed: HTTP 403 (PERMISSION_DENIED)");
    expect(inbox.status).toBe("connected");
  });

  test("inboxes that are not connected are not synced", async () => {
    const recon = await seedInbox(f.agency.id, f.recA.userId, { status: "needs_reconnect" });
    const noCred = await seedInbox(f.agency.id, f.recB.userId, { email: "lee@example.com" }, false);
    expect((await syncInbox(f.agency.id, recon, FAR(), fake)).status).toBe("needs_reconnect");
    expect((await syncInbox(f.agency.id, noCred, FAR(), fake)).status).toBe("error");
    expect(fake.calls.lists).toEqual([]);
  });
});

describe("runSyncTick", () => {
  test("syncs connected inboxes of enabled agencies only", async () => {
    await seedInbox(f.agency.id, f.recA.userId);
    await seedInbox(f.agency.id, f.recB.userId, { email: "lee@example.com", status: "needs_reconnect" });
    const [other] = await seedAgencies(db, 1);
    await asOwner(db, (tx) => tx.update(agencies).set({ enabled: false }).where(eq(agencies.id, other!.id)));
    await seedInbox(other!.id, other!.recruiterId, { email: "kim@example.net" });
    const out = await runSyncTick(FAR());
    expect(out).toEqual({ inboxes: 1, inserted: 280 });
  });

  test("starts no inbox after the deadline", async () => {
    await seedInbox(f.agency.id, f.recA.userId);
    expect(await runSyncTick(Date.now() - 1)).toEqual({ inboxes: 0, inserted: 0 });
  });
});

describe("syncInboxNow", () => {
  test("the owner can sync now; another recruiter cannot", async () => {
    const id = await seedInbox(f.agency.id, f.recA.userId);
    expect(await asMember(f.recB, () => syncInboxNow(id))).toEqual({ ok: false, error: "You do not have permission to manage this inbox." });
    const r = await asMember(f.recA, () => syncInboxNow(id));
    expect(r).toEqual({ ok: true, outcome: { status: "done", inserted: 280 } });
  });
});

describe("cron route", () => {
  const call = (auth?: string) =>
    cronGet(new NextRequest("http://localhost:3000/api/cron/gmail-sync", auth === undefined ? undefined : { headers: { authorization: auth } }));

  test("cron route rejects a missing or wrong secret with 401", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call("test-cron-secret")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call("Bearer undefined")).status).toBe(401);
    expect((await call("Bearer ")).status).toBe(401);
  });

  test("the right secret runs a tick and returns counts only", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    await seedInbox(f.agency.id, f.recA.userId);
    const res = await call("Bearer test-cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inboxes: 1, inserted: 280 });
  });
});
