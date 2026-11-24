import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { requireMember } from "@/lib/auth";
import { verifyOAuthState } from "@/lib/google/crypto";
import { completeConnection } from "@/lib/inboxes/connect";
import { CALLBACK_PATH, NONCE_COOKIE, NOT_SET_UP, gmailConnectConfigured, nonceCookieOptions, settingsRedirect } from "@/lib/inboxes/oauth";

export const dynamic = "force-dynamic";

const MISMATCH = "The connection request expired or did not match. Try again.";
const DECLINED = "Google did not connect the inbox. Try again.";

const sameNonce = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Google redirects here after consent. Verifies state and nonce, then saves the inbox. */
export async function GET(request: NextRequest) {
  const member = await requireMember();
  const origin = request.nextUrl.origin;
  const params = request.nextUrl.searchParams;
  const cookieNonce = request.cookies.get(NONCE_COOKIE)?.value;

  const outcome = await (async (): Promise<{ error: string } | "connected"> => {
    if (!gmailConnectConfigured()) return { error: NOT_SET_UP };
    // Google sends ?error=access_denied (or similar) when the user cancels. Its text is not echoed.
    if (params.has("error")) return { error: DECLINED };

    const state = verifyOAuthState(params.get("state") ?? "");
    if (
      !state ||
      !cookieNonce ||
      !sameNonce(state.nonce, cookieNonce) ||
      state.agencyId !== member.agencyId ||
      state.userId !== member.userId
    ) {
      return { error: MISMATCH };
    }
    const code = params.get("code");
    if (!code) return { error: DECLINED };

    try {
      const result = await completeConnection(member, code, `${origin}${CALLBACK_PATH}`);
      return result.ok ? "connected" : { error: result.error };
    } catch {
      return { error: "The inbox could not be connected. Try again." };
    }
  })();

  const res = settingsRedirect(origin, outcome);
  // The nonce is single use: cleared on every outcome.
  res.cookies.set(NONCE_COOKIE, "", { ...nonceCookieOptions(), maxAge: 0 });
  return res;
}
