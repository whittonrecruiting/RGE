import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/** Thrown when the token key is missing or malformed, or a stored value cannot be decrypted. Never carries key or token material. */
export class TokenKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenKeyError";
  }
}

export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The 32 byte key from RGE_TOKEN_KEY (base64), or null when unset or not exactly 32 bytes. */
function readKey(): Buffer | null {
  const raw = process.env.RGE_TOKEN_KEY?.trim();
  if (!raw || !B64.test(raw)) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

function requireKey(): Buffer {
  const key = readKey();
  if (!key) throw new TokenKeyError("RGE_TOKEN_KEY is missing or invalid. It must be base64 of exactly 32 random bytes.");
  return key;
}

/** True when RGE_TOKEN_KEY is set to base64 of exactly 32 bytes. */
export const tokenKeyConfigured = (): boolean => readKey() !== null;

/** AES-256-GCM. Format: v1:<iv b64>:<tag b64>:<ciphertext b64>. */
export function encryptToken(plain: string): string {
  const key = requireKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/** Throws TokenKeyError on a wrong key, a tampered value or an unknown format. */
export function decryptToken(enc: string): string {
  const key = requireKey();
  const parts = typeof enc === "string" ? enc.split(":") : [];
  if (parts.length !== 4 || parts[0] !== "v1") throw new TokenKeyError("Stored token has an unrecognized format.");
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ct = Buffer.from(parts[3], "base64");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("bad lengths");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenKeyError("Stored token could not be decrypted. The key is wrong or the value was altered.");
  }
}

/** Separate HMAC key derived from the token key, so the two uses never share key material. */
function stateKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", requireKey(), Buffer.alloc(0), "oauth-state", 32));
}

type StateParts = { agencyId: string; userId: string; nonce: string; issuedAt: number };

const hmac = (payload: string) => createHmac("sha256", stateKey()).update(payload).digest();

/** base64url(JSON) + "." + base64url(HMAC-SHA256). */
export function signOAuthState(p: StateParts): string {
  const { agencyId, userId, nonce, issuedAt } = p;
  const payload = Buffer.from(JSON.stringify({ agencyId, userId, nonce, issuedAt })).toString("base64url");
  return `${payload}.${hmac(payload).toString("base64url")}`;
}

/** The signed fields, or null when the signature is bad, the shape is wrong or the state is over 10 minutes old. */
export function verifyOAuthState(state: string, now = Date.now()): { agencyId: string; userId: string; nonce: string } | null {
  if (typeof state !== "string" || !readKey()) return null;
  const dot = state.indexOf(".");
  if (dot <= 0 || state.indexOf(".", dot + 1) !== -1) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = hmac(payload);
  // Canonical form only: decode, then require the bytes to re-encode to the exact text given. No plain
  // string comparison of the signature remains; the comparison is timingSafeEqual on equal-length bytes.
  const given = Buffer.from(sig, "base64url");
  const canonical = Buffer.from(given.toString("base64url"));
  const supplied = Buffer.from(sig);
  if (given.length !== expected.length || canonical.length !== supplied.length || !timingSafeEqual(canonical, supplied)) return null;
  if (!timingSafeEqual(given, expected)) return null;
  let data: Partial<StateParts>;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const { agencyId, userId, nonce, issuedAt } = data;
  if (typeof agencyId !== "string" || typeof userId !== "string" || typeof nonce !== "string" || typeof issuedAt !== "number") return null;
  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > OAUTH_STATE_MAX_AGE_MS) return null;
  return { agencyId, userId, nonce };
}
