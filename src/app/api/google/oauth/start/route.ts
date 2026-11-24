import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth";
import { GMAIL_SCOPES } from "@/lib/google/client";
import { signOAuthState } from "@/lib/google/crypto";
import {
  CALLBACK_PATH,
  GOOGLE_AUTH_URL,
  NONCE_COOKIE,
  gmailConnectConfigured,
  nonceCookieOptions,
  settingsRedirect,
} from "@/lib/inboxes/oauth";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** Sends the signed-in member to Google's consent screen for the Gmail scopes. */
export async function GET(request: NextRequest) {
  const member = await requireMember();
  const origin = request.nextUrl.origin;
  if (!gmailConnectConfigured()) return settingsRedirect(origin, { error: "not_set_up" });
  if (!can(member, "inbox.connect")) return settingsRedirect(origin, { error: "no_permission" });

  const nonce = randomBytes(32).toString("base64url");
  const state = signOAuthState({ agencyId: member.agencyId, userId: member.userId, nonce, issuedAt: Date.now() });

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", `${origin}${CALLBACK_PATH}`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set(NONCE_COOKIE, nonce, nonceCookieOptions());
  return res;
}
