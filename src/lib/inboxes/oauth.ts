import { NextResponse } from "next/server";
import { tokenKeyConfigured } from "@/lib/google/crypto";

// Shared by the OAuth start and callback routes.

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const NONCE_COOKIE = "rge_oauth_nonce";
export const CALLBACK_PATH = "/api/google/oauth/callback";
export const NOT_SET_UP = "Gmail connection is not set up yet.";

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

/** /settings#inboxes with either ?inbox=connected or ?inbox_error=<message> (percent-encoded). */
export function settingsRedirect(origin: string, outcome: { error: string } | "connected"): NextResponse {
  const query = outcome === "connected" ? "inbox=connected" : `inbox_error=${encodeURIComponent(outcome.error)}`;
  return NextResponse.redirect(new URL(`/settings?${query}#inboxes`, origin));
}
