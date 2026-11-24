import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { GET as start } from "@/app/api/google/oauth/start/route";
import { GET as callback } from "@/app/api/google/oauth/callback/route";
import { inboxes } from "@/db/schema";
import { GMAIL_SCOPES, setTestGoogleApi, type GoogleApi } from "@/lib/google/client";
import { signOAuthState } from "@/lib/google/crypto";
import { setTestTxtResolver } from "@/lib/inboxes/domain-check";
import type { Member } from "@/lib/auth";
import { asOwner, createTestDb, type TestDb } from "../helpers/test-db";
import { asMember, seedMembers, type MemberFixtures } from "../helpers/as-member";

const ORIGIN = "http://localhost:3000";
const ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "RGE_TOKEN_KEY"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

let db: TestDb;
let close: (() => Promise<void>) | undefined;
let f: MemberFixtures;

beforeEach(async () => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.RGE_TOKEN_KEY = randomBytes(32).toString("base64");
  const t = await createTestDb();
  db = t.db;
  close = t.close;
  f = await seedMembers(db);
  const nope = async () => {
    throw new Error("not used");
  };
  const api: GoogleApi = {
    exchangeCode: async () => ({ refreshToken: "1//route-refresh", accessToken: "at", scopes: [...GMAIL_SCOPES] }),
    accessToken: nope,
    revoke: async () => {},
    profile: async () => ({ emailAddress: "pat@example.com", historyId: "1" }),
    sendAsSignature: async () => null,
    listMessageIds: nope,
    messageMetadata: nope,
    history: nope,
  };
  setTestGoogleApi(api);
  setTestTxtResolver(async () => {
    throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
  });
});
afterEach(async () => {
  setTestGoogleApi(undefined);
  setTestTxtResolver(undefined);
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await close?.();
  close = undefined;
});

const req = (path: string, nonce?: string) =>
  new NextRequest(`${ORIGIN}${path}`, nonce ? { headers: { cookie: `rge_oauth_nonce=${nonce}` } } : undefined);
const stateFor = (m: Member, nonce: string) =>
  signOAuthState({ agencyId: m.agencyId, userId: m.userId, nonce, issuedAt: Date.now() });
const callbackAs = (m: Member, query: string, nonce?: string) =>
  asMember(m, () => callback(req(`/api/google/oauth/callback?${query}`, nonce)));
const location = (res: Response) => res.headers.get("location");
const MISMATCH = `${ORIGIN}/settings?inbox_error=mismatch#inboxes`;

describe("oauth start", () => {
  test("redirects to Google with offline consent, the scopes and a signed state, and sets the nonce cookie", async () => {
    const res = await asMember(f.recA, () => start(req("/api/google/oauth/start")));
    const url = new URL(location(res)!);
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("scope")).toBe(GMAIL_SCOPES.join(" "));
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/google/oauth/callback`);
    expect(url.searchParams.get("state")).toMatch(/^[\w-]+\.[\w-]+$/);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^rge_oauth_nonce=[\w-]+;/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\/api\/google\/oauth/);
    expect(cookie).toMatch(/Max-Age=600/);
  });

  test("missing config redirects to settings with the not set up message", async () => {
    delete process.env.RGE_TOKEN_KEY;
    const res = await asMember(f.recA, () => start(req("/api/google/oauth/start")));
    expect(location(res)).toBe(`${ORIGIN}/settings?inbox_error=not_set_up#inboxes`);
    const cb = await callbackAs(f.recA, "code=c&state=s", "n");
    expect(location(cb)).toBe(`${ORIGIN}/settings?inbox_error=not_set_up#inboxes`);
  });
});

describe("oauth callback", () => {
  test("a bad state is rejected and the nonce cookie is cleared", async () => {
    const res = await callbackAs(f.recA, "code=c&state=not-a-state", "n1");
    expect(location(res)).toBe(MISMATCH);
    expect(res.headers.get("set-cookie")).toMatch(/^rge_oauth_nonce=;.*Max-Age=0/i);
    expect(await asOwner(db, (tx) => tx.select().from(inboxes))).toHaveLength(0);
  });

  test("a nonce mismatch or another member's state is rejected", async () => {
    const s = encodeURIComponent(stateFor(f.recA, "nonce-a"));
    expect(location(await callbackAs(f.recA, `code=c&state=${s}`, "nonce-b"))).toBe(MISMATCH);
    expect(location(await callbackAs(f.recA, `code=c&state=${s}`))).toBe(MISMATCH);
    expect(location(await callbackAs(f.recB, `code=c&state=${s}`, "nonce-a"))).toBe(MISMATCH);
    expect(await asOwner(db, (tx) => tx.select().from(inboxes))).toHaveLength(0);
  });

  test("a matching state and nonce connects the inbox", async () => {
    const s = encodeURIComponent(stateFor(f.recA, "nonce-a"));
    const res = await callbackAs(f.recA, `code=c&state=${s}`, "nonce-a");
    expect(location(res)).toBe(`${ORIGIN}/settings?inbox=connected#inboxes`);
    expect(res.headers.get("set-cookie")).toMatch(/^rge_oauth_nonce=;/);
    const rows = await asOwner(db, (tx) => tx.select().from(inboxes));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(f.recA.userId);
  });

  test("Google's error parameter is not echoed", async () => {
    const res = await callbackAs(f.recA, "error=access_denied", "n");
    expect(location(res)).toBe(`${ORIGIN}/settings?inbox_error=declined#inboxes`);
  });
});
