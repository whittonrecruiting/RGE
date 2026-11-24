import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runSyncTick } from "@/lib/gmail-sync/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Leaves 30 seconds of the 300-second limit for the page in flight. */
const TICK_MS = 270_000;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant time; an unset or empty CRON_SECRET never matches (not even "Bearer undefined"). */
function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || header === null) return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

/** Vercel Cron, every 5 minutes. Returns counts only. */
export async function GET(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { inboxes, inserted } = await runSyncTick(Date.now() + TICK_MS);
  return NextResponse.json({ inboxes, inserted });
}
