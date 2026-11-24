import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TokenKeyError,
  decryptToken,
  encryptToken,
  signOAuthState,
  tokenKeyConfigured,
  verifyOAuthState,
} from "@/lib/google/crypto";

const saved = process.env.RGE_TOKEN_KEY;
const newKey = () => randomBytes(32).toString("base64");

beforeEach(() => {
  process.env.RGE_TOKEN_KEY = newKey();
});
afterEach(() => {
  if (saved === undefined) delete process.env.RGE_TOKEN_KEY;
  else process.env.RGE_TOKEN_KEY = saved;
});

describe("token encryption", () => {
  it("encrypt then decrypt round-trips and each encryption differs", () => {
    const a = encryptToken("1//refresh-token-value");
    const b = encryptToken("1//refresh-token-value");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(a).not.toContain("refresh-token-value");
    expect(decryptToken(a)).toBe("1//refresh-token-value");
    expect(decryptToken(b)).toBe("1//refresh-token-value");
  });

  it("a tampered ciphertext or wrong key throws TokenKeyError", () => {
    const enc = encryptToken("secret-token");
    const parts = enc.split(":");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 1;
    const tampered = [parts[0], parts[1], parts[2], ct.toString("base64")].join(":");
    expect(() => decryptToken(tampered)).toThrow(TokenKeyError);
    expect(() => decryptToken("garbage")).toThrow(TokenKeyError);
    process.env.RGE_TOKEN_KEY = newKey();
    expect(() => decryptToken(enc)).toThrow(TokenKeyError);
  });

  it("reports and rejects a missing or malformed key without echoing it", () => {
    expect(tokenKeyConfigured()).toBe(true);
    process.env.RGE_TOKEN_KEY = "not-a-valid-key-value";
    expect(tokenKeyConfigured()).toBe(false);
    let msg = "";
    try {
      encryptToken("x");
    } catch (e) {
      expect(e).toBeInstanceOf(TokenKeyError);
      msg = (e as Error).message;
    }
    expect(msg).toContain("RGE_TOKEN_KEY");
    expect(msg).not.toContain("not-a-valid-key-value");
    process.env.RGE_TOKEN_KEY = randomBytes(16).toString("base64");
    expect(tokenKeyConfigured()).toBe(false);
    delete process.env.RGE_TOKEN_KEY;
    expect(tokenKeyConfigured()).toBe(false);
    expect(() => decryptToken("v1:a:b:c")).toThrow(TokenKeyError);
  });
});

describe("OAuth state", () => {
  const p = { agencyId: "agency-1", userId: "user-1", nonce: "n-123", issuedAt: 1_000_000 };

  it("verifies, rejects a changed field, and expires after 10 minutes", () => {
    const state = signOAuthState(p);
    expect(verifyOAuthState(state, p.issuedAt + 1000)).toEqual({ agencyId: "agency-1", userId: "user-1", nonce: "n-123" });

    const [payload, sig] = state.split(".");
    const changed = JSON.parse(Buffer.from(payload, "base64url").toString());
    changed.agencyId = "agency-2";
    const forged = `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${sig}`;
    expect(verifyOAuthState(forged, p.issuedAt + 1000)).toBeNull();
    expect(verifyOAuthState(`${payload}.${sig.slice(0, -2)}AA`, p.issuedAt + 1000)).toBeNull();
    expect(verifyOAuthState("nonsense", p.issuedAt)).toBeNull();
    expect(verifyOAuthState(`${payload}.`, p.issuedAt)).toBeNull();

    expect(verifyOAuthState(state, p.issuedAt + 10 * 60_000)).not.toBeNull();
    expect(verifyOAuthState(state, p.issuedAt + 10 * 60_000 + 1)).toBeNull();
  });

  it("is invalid under a different key", () => {
    const state = signOAuthState(p);
    process.env.RGE_TOKEN_KEY = newKey();
    expect(verifyOAuthState(state, p.issuedAt)).toBeNull();
  });
});
