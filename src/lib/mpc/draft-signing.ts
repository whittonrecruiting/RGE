import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProfileDraft } from "@/lib/ai/extract-profile";

export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** True when the signing secret is set. Without it extraction is switched off. */
export const draftSigningConfigured = () => Boolean(process.env.RGE_DRAFT_SECRET);

/** JSON with object keys sorted, so the same data always gives the same bytes. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

type Parts = { mpcId: string; userId: string; issuedAt: number; draft: ProfileDraft };

/** HMAC-SHA256 (hex) over { mpcId, userId, issuedAt, draft }. Throws if the secret is not set. */
export function signDraft(parts: Parts): string {
  const secret = process.env.RGE_DRAFT_SECRET;
  if (!secret) throw new Error("RGE_DRAFT_SECRET is not set.");
  const { mpcId, userId, issuedAt, draft } = parts;
  return createHmac("sha256", secret).update(canonical({ mpcId, userId, issuedAt, draft })).digest("hex");
}

/** True when signature matches these parts and the draft is under 24 hours old. */
export function verifyDraft(parts: Parts, signature: unknown, now = Date.now()): boolean {
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (!Number.isFinite(parts.issuedAt) || parts.issuedAt > now + 60_000 || now - parts.issuedAt > DRAFT_MAX_AGE_MS) {
    return false;
  }
  const expected = Buffer.from(signDraft(parts), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
