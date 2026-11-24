export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"];

/** Google rejected the refresh token (invalid_grant or revoked). The inbox needs to be reconnected. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export type GmailMeta = {
  id: string;
  threadId: string;
  internalDate: number;
  labelIds: string[];
  /** Lowercase names: from, to, cc, bcc, date, x-failed-recipients, list-unsubscribe, precedence, auto-submitted, subject. Read for DSN detection, never stored. */
  headers: Record<string, string>;
};

export interface GoogleApi {
  exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; accessToken: string; scopes: string[] }>;
  accessToken(refreshToken: string): Promise<string>;
  revoke(refreshToken: string): Promise<void>;
  profile(accessToken: string): Promise<{ emailAddress: string; historyId: string }>;
  sendAsSignature(accessToken: string, email: string): Promise<string | null>;
  listMessageIds(accessToken: string, q: string, pageToken?: string): Promise<{ ids: string[]; nextPageToken?: string }>;
  messageMetadata(accessToken: string, id: string): Promise<GmailMeta>;
  history(
    accessToken: string,
    startHistoryId: string,
    pageToken?: string,
  ): Promise<{ messageIds: string[]; historyId: string; nextPageToken?: string } | "expired">;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const REQUEST_TIMEOUT_MS = 30_000;
const BACKOFF_MS = [1000, 2000, 4000];
const METADATA_HEADERS = ["From", "To", "Cc", "Bcc", "Date", "X-Failed-Recipients", "List-Unsubscribe", "Precedence", "Auto-Submitted", "Subject"];

type Json = Record<string, unknown>;
type Reply = { status: number; ok: boolean; body: Json };

/** Google's short error code (for example invalid_grant, NOT_FOUND), only if it looks like a code. Never free text. */
function errorCode(body: Json): string | undefined {
  const e = body.error;
  const candidate = typeof e === "string" ? e : e && typeof e === "object" ? (e as Json).status : undefined;
  return typeof candidate === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(candidate) ? candidate : undefined;
}

/** Error text carries the operation, status and Google's code only. No request or response bodies, tokens or codes. */
function failure(op: string, r: Reply): Error {
  const code = errorCode(r.body);
  return new Error(`Google ${op} failed: HTTP ${r.status}${code ? ` (${code})` : ""}`);
}

export function createGoogleApi(opts: { sleep?: (ms: number) => Promise<void> } = {}): GoogleApi {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function send(op: string, url: string, init: RequestInit, retry = true): Promise<Reply> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch {
        // Covers timeouts too. The underlying error can embed the URL (query text, page tokens), so it is not passed on.
        throw new Error(`Google ${op} failed: network error`);
      }
      if (retry && (res.status === 429 || res.status >= 500) && attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      let body: Json = {};
      try {
        const parsed: unknown = await res.json();
        if (parsed && typeof parsed === "object") body = parsed as Json;
      } catch {
        // Empty or non-JSON body.
      }
      return { status: res.status, ok: res.ok, body };
    }
  }

  const tokenPost = (op: string, params: Record<string, string>, retry = true) => {
    const client_id = process.env.GOOGLE_CLIENT_ID;
    const client_secret = process.env.GOOGLE_CLIENT_SECRET;
    if (!client_id || !client_secret) {
      throw new Error("Gmail connection is not set up (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
    }
    return send(
      op,
      TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id, client_secret, ...params }).toString(),
      },
      retry,
    );
  };

  const gmail = (op: string, accessToken: string, path: string, params: [string, string][] = []) => {
    const u = new URL(`${GMAIL}/${path}`);
    for (const [k, v] of params) u.searchParams.append(k, v);
    return send(op, u.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
  };

  return {
    async exchangeCode(code, redirectUri) {
      const r = await tokenPost("code exchange", { grant_type: "authorization_code", code, redirect_uri: redirectUri }, false); // the code is single-use: never retried
      if (!r.ok) throw failure("code exchange", r);
      const { access_token, refresh_token, scope } = r.body;
      if (typeof access_token !== "string" || !access_token) throw new Error("Google code exchange returned no access token.");
      if (typeof refresh_token !== "string" || !refresh_token) {
        throw new Error("Google did not return a refresh token. Reconnect and approve offline access with consent.");
      }
      const scopes = typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : [];
      return { refreshToken: refresh_token, accessToken: access_token, scopes };
    },

    async accessToken(refreshToken) {
      const r = await tokenPost("token refresh", { grant_type: "refresh_token", refresh_token: refreshToken });
      if (!r.ok) {
        if (errorCode(r.body) === "invalid_grant") throw new GoogleAuthError("Google rejected the stored authorization (invalid_grant). Reconnect the inbox.");
        throw failure("token refresh", r);
      }
      const t = r.body.access_token;
      if (typeof t !== "string" || !t) throw new Error("Google token refresh returned no access token.");
      return t;
    },

    async revoke(refreshToken) {
      // The token goes in the POST body, never the URL, so request instrumentation cannot record it.
      const r = await send("revoke", REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
      // An already revoked or expired token is the outcome we wanted.
      if (!r.ok && !(r.status === 400 && errorCode(r.body) === "invalid_token")) throw failure("revoke", r);
    },

    async profile(accessToken) {
      const r = await gmail("profile", accessToken, "profile");
      if (!r.ok) throw failure("profile", r);
      const { emailAddress, historyId } = r.body;
      if (typeof emailAddress !== "string" || historyId === undefined || historyId === null) throw new Error("Google profile response was incomplete.");
      return { emailAddress, historyId: String(historyId) };
    },

    async sendAsSignature(accessToken, email) {
      const r = await gmail("sendAs", accessToken, "settings/sendAs");
      if (!r.ok) throw failure("sendAs", r);
      const list = Array.isArray(r.body.sendAs) ? (r.body.sendAs as Json[]) : [];
      const want = email.trim().toLowerCase();
      const hit = list.find((s) => typeof s.sendAsEmail === "string" && s.sendAsEmail.toLowerCase() === want);
      return hit && typeof hit.signature === "string" && hit.signature ? hit.signature : null;
    },

    async listMessageIds(accessToken, q, pageToken) {
      const params: [string, string][] = [["q", q], ["maxResults", "100"]];
      if (pageToken) params.push(["pageToken", pageToken]);
      const r = await gmail("messages list", accessToken, "messages", params);
      if (!r.ok) throw failure("messages list", r);
      const msgs = Array.isArray(r.body.messages) ? (r.body.messages as Json[]) : [];
      const ids = msgs.map((m) => m.id).filter((i): i is string => typeof i === "string");
      const next = r.body.nextPageToken;
      return { ids, nextPageToken: typeof next === "string" ? next : undefined };
    },

    async messageMetadata(accessToken, id) {
      const params: [string, string][] = [["format", "metadata"], ...METADATA_HEADERS.map((h): [string, string] => ["metadataHeaders", h])];
      const r = await gmail("message get", accessToken, `messages/${encodeURIComponent(id)}`, params);
      if (!r.ok) throw failure("message get", r);
      const payload = (r.body.payload ?? {}) as Json;
      const headers: Record<string, string> = {};
      for (const h of Array.isArray(payload.headers) ? (payload.headers as Json[]) : []) {
        if (typeof h.name === "string" && typeof h.value === "string") headers[h.name.toLowerCase()] = h.value;
      }
      return {
        id: String(r.body.id ?? id),
        threadId: String(r.body.threadId ?? ""),
        internalDate: Number(r.body.internalDate ?? 0),
        labelIds: Array.isArray(r.body.labelIds) ? (r.body.labelIds as unknown[]).filter((l): l is string => typeof l === "string") : [],
        headers,
      };
    },

    async history(accessToken, startHistoryId, pageToken) {
      const params: [string, string][] = [["startHistoryId", startHistoryId], ["historyTypes", "messageAdded"]];
      if (pageToken) params.push(["pageToken", pageToken]);
      const r = await gmail("history list", accessToken, "history", params);
      if (r.status === 404) return "expired";
      if (!r.ok) throw failure("history list", r);
      const ids = new Set<string>();
      for (const h of Array.isArray(r.body.history) ? (r.body.history as Json[]) : []) {
        for (const a of Array.isArray(h.messagesAdded) ? (h.messagesAdded as Json[]) : []) {
          const id = (a.message as Json | undefined)?.id;
          if (typeof id === "string") ids.add(id);
        }
      }
      const next = r.body.nextPageToken;
      return { messageIds: [...ids], historyId: String(r.body.historyId ?? startHistoryId), nextPageToken: typeof next === "string" ? next : undefined };
    },
  };
}

let testApi: GoogleApi | undefined;

/** Test only: replace the Google client with a fake. */
export function setTestGoogleApi(api: GoogleApi | undefined): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setTestGoogleApi is only available when NODE_ENV is 'test'");
  testApi = api;
}

let real: GoogleApi | undefined;

/** The test override if set, else the fetch implementation. */
export function googleApi(): GoogleApi {
  return testApi ?? (real ??= createGoogleApi());
}
