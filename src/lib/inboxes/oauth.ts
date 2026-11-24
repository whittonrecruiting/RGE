import { NextResponse } from "next/server";
import { tokenKeyConfigured } from "@/lib/google/crypto";
import type { InboxErrorCode } from "./connect-errors";

// Shared by the OAuth start and callback routes.

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const NONCE_COOKIE = "rge_oauth_nonce";
export const CALLBACK_PATH = "/api/google/oauth/callback";

/** Google client id and secret plus a valid token key. Without all three nothing can be stored safely. */
export const gmailConnectConfigured = (): boolean =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && tokenKeyConfigured());

export const nonceCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test",
  sameSite: "lax" as const,
  path: "/api/google/oauth",
  maxAge: 600,
});

/** /settings#inboxes with either ?inbox=connected or ?inbox_error=<code>. Never free text: see connect-errors.ts. */
export function settingsRedirect(origin: string, outcome: { error: InboxErrorCode } | "connected"): NextResponse {
  const query = outcome === "connected" ? "inbox=connected" : `inbox_error=${outcome.error}`;
  return NextResponse.redirect(new URL(`/settings?${query}#inboxes`, origin));
}
