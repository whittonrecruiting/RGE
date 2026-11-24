import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { inboxCredentials, inboxes } from "@/db/schema";
import { decryptToken } from "@/lib/google/crypto";
import { GMAIL_SCOPES, setTestGoogleApi, type GoogleApi } from "@/lib/google/client";
import { completeConnection, isInboxEmailConflict } from "@/lib/inboxes/connect";
import { INBOX_ERROR_MESSAGES, inboxErrorMessage } from "@/lib/inboxes/connect-errors";
import { withAgency } from "@/db/with-agency";
import { disconnectInbox, setPrimaryInbox } from "@/lib/inboxes/actions";
import { setTestTxtResolver } from "@/lib/inboxes/domain-check";
import { listInboxes } from "@/lib/inboxes/queries";
import type { Member } from "@/lib/auth";
import { asOwner, createTestDb, type TestDb } from "../helpers/test-db";
import { asMember, seedMembers, type MemberFixtures } from "../helpers/as-member";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const NOW = new Date("2026-11-24T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const REDIRECT = "http://localhost:3000/api/google/oauth/callback";
const SIG = "<div>Pat Example<br>Example Recruiting</div>";

let db: TestDb;
let close: (() => Promise<void>) | undefined;
let f: MemberFixtures;
const savedKey = process.env.RGE_TOKEN_KEY;

type FakeOpts = { email: string; refresh?: string; scopes?: string[] };
let revoked: string[];
let next: FakeOpts;

function fakeGoogle(): GoogleApi {
  const nope = async () => {
    throw new Error("not used in this test");
  };
  return {
    exchangeCode: async () => ({
      refreshToken: next.refresh ?? "1//fake-refresh-token",
      accessToken: "fake-access-token",
      scopes: next.scopes ?? [...GMAIL_SCOPES],
    }),
    accessToken: nope,
    revoke: async (t) => {
      revoked.push(t);
    },
    profile: async () => ({ emailAddress: next.email, historyId: "1000" }),
    sendAsSignature: async () => SIG,
    listMessageIds: nope,
    messageMetadata: nope,
    history: nope,
  };
}

beforeEach(async () => {
  process.env.RGE_TOKEN_KEY = randomBytes(32).toString("base64");
  const t = await createTestDb();
  db = t.db;
  close = t.close;
  f = await seedMembers(db);
  revoked = [];
  next = { email: "pat@example.com" };
  setTestGoogleApi(fakeGoogle());
  setTestTxtResolver(async (name) => {
    if (name === "example.com") return [["v=spf1 include:_spf.google.com ~all"]];
    if (name === "_dmarc.example.com") return [["v=DMARC1; p=none"]];
    throw Object.assign(new Error("queryTxt ENODATA"), { code: "ENODATA" });
  });
});
afterEach(async () => {
  setTestGoogleApi(undefined);
  setTestTxtResolver(undefined);
  if (savedKey === undefined) delete process.env.RGE_TOKEN_KEY;
  else process.env.RGE_TOKEN_KEY = savedKey;
  await close?.();
  close = undefined;
});

const connect = (m: Member, opts: FakeOpts) => {
  next = opts;
  return completeConnection(m, "4/fake-code", REDIRECT, NOW);
};
const allInboxes = () => asOwner(db, (tx) => tx.select().from(inboxes));
const allCreds = () => asOwner(db, (tx) => tx.select().from(inboxCredentials));
const inbox = async (id: string) => (await allInboxes()).find((i) => i.id === id)!;

describe("completeConnection", () => {
  test("connect stores an encrypted token, signature and backfill_from 365 days back", async () => {
    const r = await connect(f.recA, { email: "Pat@Example.com", refresh: "1//refresh-A" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = await inbox(r.inboxId);
    expect(row.email).toBe("pat@example.com");
    expect(row.userId).toBe(f.recA.userId);
    expect(row.status).toBe("connected");
    expect(row.signatureHtml).toBe(SIG);
    expect(row.backfillFrom.getTime()).toBe(NOW.getTime() - 365 * DAY);
    expect(row.domainCheck).toMatchObject({ spf: { ok: true }, dkim: { ok: false }, dmarc: { ok: true } });
    expect(row.domainCheckedAt?.getTime()).toBe(NOW.getTime());
    const creds = await allCreds();
    expect(creds).toHaveLength(1);
    expect(creds[0]!.inboxId).toBe(r.inboxId);
    expect(creds[0]!.refreshTokenEnc).not.toContain("refresh-A");
    expect(decryptToken(creds[0]!.refreshTokenEnc)).toBe("1//refresh-A");
    expect(creds[0]!.scopes).toEqual(GMAIL_SCOPES);
    expect(revoked).toEqual([]);
  });

  test("first inbox becomes primary, second does not", async () => {
    const a = await connect(f.recA, { email: "pat@example.com" });
    const b = await connect(f.recA, { email: "pat.second@example.com" });
    const c = await connect(f.recB, { email: "lee@example.com" });
    if (!a.ok || !b.ok || !c.ok) throw new Error("connect failed");
    expect((await inbox(a.inboxId)).isPrimary).toBe(true);
    expect((await inbox(b.inboxId)).isPrimary).toBe(false);
    // Primary is per member: recB's first inbox is their primary.
    expect((await inbox(c.inboxId)).isPrimary).toBe(true);
  });

  test("connecting an inbox owned by another member is refused", async () => {
    const a = await connect(f.recA, { email: "pat@example.com", refresh: "1//refresh-A" });
    if (!a.ok) throw new Error("connect failed");
    const b = await connect(f.recB, { email: "pat@example.com", refresh: "1//refresh-B" });
    expect(b).toEqual({ ok: false, error: "teammate" });
    expect(inboxErrorMessage("teammate")).toBe("This inbox is already connected by a teammate.");
    const rows = await allInboxes();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(f.recA.userId);
    const [cred] = await allCreds();
    expect(decryptToken(cred!.refreshTokenEnc)).toBe("1//refresh-A");
    // Revoking would end the same Google grant the teammate's stored token relies on.
    expect(revoked).toEqual([]);
  });

  test("reconnecting your own inbox keeps its cursor and sets status connected", async () => {
    const a = await connect(f.recA, { email: "pat@example.com", refresh: "1//refresh-old" });
    if (!a.ok) throw new Error("connect failed");
    const firstFrom = (await inbox(a.inboxId)).backfillFrom;
    await asOwner(db, (tx) =>
      tx
        .update(inboxes)
        .set({ status: "needs_reconnect", backfillCursor: { pageToken: "p2" }, historyId: "h9", lastSyncError: "Reconnect needed" })
        .where(eq(inboxes.id, a.inboxId)),
    );
    const again = await connect(f.recA, { email: "pat@example.com", refresh: "1//refresh-new" });
    expect(again).toEqual({ ok: true, inboxId: a.inboxId });
    const row = await inbox(a.inboxId);
    expect(row.status).toBe("connected");
    expect(row.backfillCursor).toEqual({ pageToken: "p2" });
    expect(row.historyId).toBe("h9");
    expect(row.lastSyncError).toBeNull();
    expect(row.backfillFrom.getTime()).toBe(firstFrom.getTime());
    expect(row.isPrimary).toBe(true);
    const creds = await allCreds();
    expect(creds).toHaveLength(1);
    expect(decryptToken(creds[0]!.refreshTokenEnc)).toBe("1//refresh-new");
  });

  test("missing gmail.send scope is refused with a message to allow all permissions", async () => {
    const r = await connect(f.recA, {
      email: "pat@example.com",
      refresh: "1//refresh-partial",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("scopes");
    expect(inboxErrorMessage(r.error)).toMatch(/allow all permissions/i);
    expect(r.error).not.toContain("refresh-partial");
    expect(await allInboxes()).toHaveLength(0);
    expect(await allCreds()).toHaveLength(0);
    expect(revoked).toEqual(["1//refresh-partial"]);
  });

  test("a failed code exchange returns a short error without the code", async () => {
    setTestGoogleApi({
      ...fakeGoogle(),
      exchangeCode: async () => {
        throw new Error("Google code exchange failed: HTTP 400 (invalid_grant)");
      },
    });
    const r = await completeConnection(f.recA, "4/secret-code", REDIRECT, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("failed");
    expect(await allInboxes()).toHaveLength(0);
  });

  test("a teammate's disconnected inbox is refused with its own code and not reassigned", async () => {
    const a = await connect(f.recA, { email: "pat@example.com" });
    if (!a.ok) throw new Error("connect failed");
    await asMember(f.recA, () => disconnectInbox(a.inboxId));
    revoked = [];
    const b = await connect(f.recB, { email: "pat@example.com", refresh: "1//refresh-B" });
    expect(b).toEqual({ ok: false, error: "teammate_before" });
    expect(inboxErrorMessage("teammate_before")).toBe("This inbox was connected by a teammate before. Ask an Owner or Admin.");
    const row = await inbox(a.inboxId);
    expect(row.userId).toBe(f.recA.userId);
    expect(row.status).toBe("disconnected");
    expect(await allCreds()).toHaveLength(0);
    expect(revoked).toEqual([]);
  });

  test("a concurrent insert of the same mailbox is recognized as the teammate case", async () => {
    const a = await connect(f.recA, { email: "pat@example.com" });
    if (!a.ok) throw new Error("connect failed");
    const err = await withAgency(f.agency.id, (tx) =>
      tx.insert(inboxes).values({ agencyId: f.agency.id, userId: f.recB.userId, email: "pat@example.com", backfillFrom: NOW }),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    expect(isInboxEmailConflict(err)).toBe(true);
    expect(isInboxEmailConflict(new Error("something else"))).toBe(false);
    expect(isInboxEmailConflict(Object.assign(new Error("dup"), { code: "23505", constraint: "other_unique" }))).toBe(false);
  });

  test("the database allows only one primary inbox per member", async () => {
    const a = await connect(f.recA, { email: "pat@example.com" });
    const b = await connect(f.recA, { email: "pat.second@example.com" });
    if (!a.ok || !b.ok) throw new Error("connect failed");
    await expect(
      withAgency(f.agency.id, (tx) => tx.update(inboxes).set({ isPrimary: true }).where(eq(inboxes.id, b.inboxId))),
    ).rejects.toThrow();
  });
});

describe("inboxErrorMessage", () => {
  test("maps known codes, falls back for unknown ones and passes null through", () => {
    expect(inboxErrorMessage("not_set_up")).toBe("Gmail connection is not set up yet.");
    expect(inboxErrorMessage("scopes")).toBe(INBOX_ERROR_MESSAGES.scopes);
    expect(inboxErrorMessage("<script>alert(1)</script>")).toBe("Gmail could not be connected. Try again.");
    expect(inboxErrorMessage("toString")).toBe("Gmail could not be connected. Try again.");
    expect(inboxErrorMessage(null)).toBeNull();
  });
});

describe("disconnect and primary", () => {
  test("disconnect deletes the credential, keeps the row, and a recruiter cannot disconnect a teammate's inbox", async () => {
    const a = await connect(f.recA, { email: "pat@example.com", refresh: "1//refresh-A" });
    if (!a.ok) throw new Error("connect failed");

    const denied = await asMember(f.recB, () => disconnectInbox(a.inboxId));
    expect(denied.ok).toBe(false);
    expect(await allCreds()).toHaveLength(1);
    expect(revoked).toEqual([]);

    const done = await asMember(f.recA, () => disconnectInbox(a.inboxId));
    expect(done).toEqual({ ok: true });
    expect(await allCreds()).toHaveLength(0);
    const row = await inbox(a.inboxId);
    expect(row.status).toBe("disconnected");
    expect(row.isPrimary).toBe(false);
    expect(revoked).toEqual(["1//refresh-A"]);
  });

  test("disconnect still succeeds when Google revoke fails", async () => {
    const a = await connect(f.recA, { email: "pat@example.com" });
    if (!a.ok) throw new Error("connect failed");
    setTestGoogleApi({
      ...fakeGoogle(),
      revoke: async () => {
        throw new Error("Google revoke failed: network error");
      },
    });
    expect(await asMember(f.admin, () => disconnectInbox(a.inboxId))).toEqual({ ok: true });
    expect(await allCreds()).toHaveLength(0);
  });

  test("setPrimaryInbox moves primary within the owner's inboxes; a teammate cannot", async () => {
    const a = await connect(f.recA, { email: "pat@example.com" });
    const b = await connect(f.recA, { email: "pat.second@example.com" });
    const c = await connect(f.recB, { email: "lee@example.com" });
    if (!a.ok || !b.ok || !c.ok) throw new Error("connect failed");

    expect((await asMember(f.recB, () => setPrimaryInbox(b.inboxId))).ok).toBe(false);
    expect(await asMember(f.recA, () => setPrimaryInbox(b.inboxId))).toEqual({ ok: true });
    expect((await inbox(a.inboxId)).isPrimary).toBe(false);
    expect((await inbox(b.inboxId)).isPrimary).toBe(true);
    expect((await inbox(c.inboxId)).isPrimary).toBe(true);

    await asMember(f.recA, () => disconnectInbox(a.inboxId));
    expect((await asMember(f.recA, () => setPrimaryInbox(a.inboxId))).ok).toBe(false);
  });

  test("a new inbox becomes primary once the old primary is disconnected", async () => {
    const a = await connect(f.recA, { email: "pat@example.com" });
    if (!a.ok) throw new Error("connect failed");
    await asMember(f.recA, () => disconnectInbox(a.inboxId));
    const b = await connect(f.recA, { email: "pat.second@example.com" });
    if (!b.ok) throw new Error("connect failed");
    expect((await inbox(b.inboxId)).isPrimary).toBe(true);
  });
});

describe("listInboxes", () => {
  test("shows every agency inbox with ownership and manage rights, never the token", async () => {
    const a = await connect(f.recA, { email: "pat@example.com", refresh: "1//refresh-A" });
    if (!a.ok) throw new Error("connect failed");

    const mine = await listInboxes(f.recA);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      id: a.inboxId,
      email: "pat@example.com",
      isMine: true,
      status: "connected",
      isPrimary: true,
      hasSignature: true,
      canManage: true,
      backfillDoneAt: null,
    });
    expect(mine[0]!.ownerName).toMatch(/\S/);
    expect(mine[0]!.domainCheck?.spf.ok).toBe(true);
    expect(JSON.stringify(mine)).not.toContain("refresh-A");
    expect(JSON.stringify(mine)).not.toContain("v1:");

    const teammate = await listInboxes(f.recB);
    expect(teammate[0]).toMatchObject({ isMine: false, canManage: false });
    expect((await listInboxes(f.admin))[0]).toMatchObject({ isMine: false, canManage: true });
  });
});
