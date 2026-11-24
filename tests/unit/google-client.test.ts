import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GMAIL_SCOPES, GoogleAuthError, createGoogleApi, googleApi, setTestGoogleApi, type GoogleApi } from "@/lib/google/client";

const REFRESH = "1//super-secret-refresh-token";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
const sleeps: number[] = [];
const api = () => createGoogleApi({ sleep: async (ms) => void sleeps.push(ms) });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  sleeps.length = 0;
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id.example");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret-value");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setTestGoogleApi(undefined);
});

describe("google client", () => {
  it("exposes exactly the two Gmail scopes", () => {
    expect(GMAIL_SCOPES).toEqual(["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"]);
  });

  it("invalid_grant on refresh throws GoogleAuthError", async () => {
    fetchMock.mockResolvedValue(json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }));
    await expect(api().accessToken(REFRESH)).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it("errors never include the refresh token, secret or request body", async () => {
    fetchMock.mockResolvedValue(json(400, { error: "invalid_grant" }));
    const err1 = await api().accessToken(REFRESH).then(() => null, (e: Error) => e);
    expect(err1).toBeInstanceOf(Error);
    expect(err1!.message).not.toContain(REFRESH);
    expect(err1!.message).not.toContain("client-secret-value");
    fetchMock.mockImplementation(async () => json(500, { error: { message: REFRESH } }));
    const err2 = await api().revoke(REFRESH).then(() => null, (e: Error) => e);
    expect(err2).toBeInstanceOf(Error);
    expect(err2!.message).toContain("500");
    expect(err2!.message).not.toContain(REFRESH);
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error(`connect failed for ${REFRESH}`));
    const err3 = await api().revoke(REFRESH).then(() => null, (e: Error) => e);
    expect(err3!.message).toMatch(/network error/);
    expect(err3!.message).not.toContain(REFRESH);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(json(403, { error: { code: 403, message: `bad ${REFRESH}`, status: "PERMISSION_DENIED" } }));
    const err = await api().profile("ya29.access-token").then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain("403");
    expect(err!.message).not.toContain(REFRESH);
    expect(err!.message).not.toContain("ya29.access-token");
  });

  it("history 404 returns expired", async () => {
    fetchMock.mockResolvedValue(json(404, { error: { code: 404, status: "NOT_FOUND" } }));
    expect(await api().history("tok", "123")).toBe("expired");
  });

  it("a 500 then 200 retries and succeeds, with 1 second backoff", async () => {
    fetchMock
      .mockResolvedValueOnce(json(500, { error: { code: 500 } }))
      .mockResolvedValueOnce(json(200, { emailAddress: "a@example.com", historyId: "42" }));
    expect(await api().profile("tok")).toEqual({ emailAddress: "a@example.com", historyId: "42" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1000]);
  });

  it("gives up after 3 retries with 1, 2 and 4 second backoff", async () => {
    fetchMock.mockImplementation(async () => json(429, { error: { code: 429 } }));
    await expect(api().profile("tok")).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("exchangeCode returns tokens and scopes, and throws when no refresh token comes back", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { access_token: "ya29.a", refresh_token: REFRESH, scope: GMAIL_SCOPES.join(" ") }));
    expect(await api().exchangeCode("auth-code", "https://app.example.com/cb")).toEqual({
      refreshToken: REFRESH,
      accessToken: "ya29.a",
      scopes: GMAIL_SCOPES,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("client_id")).toBe("client-id.example");

    fetchMock.mockResolvedValueOnce(json(200, { access_token: "ya29.b", scope: "x" }));
    const err = await api().exchangeCode("auth-code-2", "https://app.example.com/cb").then(() => null, (e: Error) => e);
    expect(err!.message).toMatch(/refresh token/i);
    expect(err!.message).not.toContain("auth-code-2");
    expect(err!.message).not.toContain("ya29.b");
  });

  it("accessToken refreshes with the refresh_token grant", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { access_token: "ya29.new" }));
    expect(await api().accessToken(REFRESH)).toBe("ya29.new");
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe(REFRESH);
  });

  it("revoke posts to the revoke endpoint", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await api().revoke(REFRESH);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(url)).not.toContain(REFRESH);
    expect(new URLSearchParams(init.body as string).get("token")).toBe(REFRESH);
  });

  it("revoke succeeds on invalid_token 400 but throws on other 400s", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: "invalid_token" }));
    await expect(api().revoke(REFRESH)).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(json(400, { error: "invalid_request" }));
    await expect(api().revoke(REFRESH)).rejects.toThrow(/400/);
  });

  it("every request carries a timeout signal", async () => {
    fetchMock.mockResolvedValue(json(200, { emailAddress: "a@example.com", historyId: "1" }));
    await api().profile("tok");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("a missing client id or secret throws a clear error and sends nothing", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    await expect(api().accessToken(REFRESH)).rejects.toThrow(/GOOGLE_CLIENT_ID \/ GOOGLE_CLIENT_SECRET/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchangeCode is not retried on 5xx", async () => {
    fetchMock.mockResolvedValue(json(503, {}));
    await expect(api().exchangeCode("c", "https://app.example.com/cb")).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("sendAsSignature picks the matching address case-insensitively, or null", async () => {
    fetchMock.mockResolvedValue(
      json(200, { sendAs: [{ sendAsEmail: "other@example.com", signature: "no" }, { sendAsEmail: "Me@Example.com", signature: "<b>sig</b>" }] }),
    );
    expect(await api().sendAsSignature("tok", "me@example.com")).toBe("<b>sig</b>");
    fetchMock.mockResolvedValue(json(200, { sendAs: [{ sendAsEmail: "me@example.com" }] }));
    expect(await api().sendAsSignature("tok", "me@example.com")).toBeNull();
    fetchMock.mockResolvedValue(json(200, {}));
    expect(await api().sendAsSignature("tok", "me@example.com")).toBeNull();
  });

  it("listMessageIds passes q, maxResults and pageToken", async () => {
    fetchMock.mockResolvedValue(json(200, { messages: [{ id: "a" }, { id: "b" }], nextPageToken: "np" }));
    expect(await api().listMessageIds("tok", "in:sent after:2026/01/01", "pt")).toEqual({ ids: ["a", "b"], nextPageToken: "np" });
    const u = new URL(fetchMock.mock.calls[0][0] as string);
    expect(u.pathname).toBe("/gmail/v1/users/me/messages");
    expect(u.searchParams.get("q")).toBe("in:sent after:2026/01/01");
    expect(u.searchParams.get("maxResults")).toBe("100");
    expect(u.searchParams.get("pageToken")).toBe("pt");
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("authorization")).toBe("Bearer tok");
    fetchMock.mockResolvedValue(json(200, { resultSizeEstimate: 0 }));
    expect(await api().listMessageIds("tok", "q")).toEqual({ ids: [], nextPageToken: undefined });
  });

  it("messageMetadata requests metadata format and lowercases headers", async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        id: "m1",
        threadId: "t1",
        internalDate: "1700000000000",
        labelIds: ["SENT"],
        payload: { headers: [{ name: "From", value: "a@example.com" }, { name: "To", value: "b@example.org" }, { name: "Subject", value: "Hi" }] },
      }),
    );
    const m = await api().messageMetadata("tok", "m1");
    expect(m).toEqual({
      id: "m1",
      threadId: "t1",
      internalDate: 1700000000000,
      labelIds: ["SENT"],
      headers: { from: "a@example.com", to: "b@example.org", subject: "Hi" },
    });
    const u = new URL(fetchMock.mock.calls[0][0] as string);
    expect(u.searchParams.get("format")).toBe("metadata");
    expect(u.searchParams.getAll("metadataHeaders")).toEqual([
      "From", "To", "Cc", "Bcc", "Date", "X-Failed-Recipients", "List-Unsubscribe", "Precedence", "Auto-Submitted", "Subject",
    ]);
  });

  it("history collects de-duplicated added message ids and the response historyId", async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        history: [{ messagesAdded: [{ message: { id: "a" } }, { message: { id: "b" } }] }, { messagesAdded: [{ message: { id: "a" } }] }, {}],
        historyId: "999",
        nextPageToken: "n",
      }),
    );
    expect(await api().history("tok", "100", "pg")).toEqual({ messageIds: ["a", "b"], historyId: "999", nextPageToken: "n" });
    const u = new URL(fetchMock.mock.calls[0][0] as string);
    expect(u.searchParams.get("startHistoryId")).toBe("100");
    expect(u.searchParams.get("historyTypes")).toBe("messageAdded");
    expect(u.searchParams.get("pageToken")).toBe("pg");
  });

  it("googleApi returns the test override when set", () => {
    const fake = {} as GoogleApi;
    setTestGoogleApi(fake);
    expect(googleApi()).toBe(fake);
    setTestGoogleApi(undefined);
    expect(googleApi()).not.toBe(fake);
  });
});
