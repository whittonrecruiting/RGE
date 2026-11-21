import { and, count, eq, gt, sql } from "drizzle-orm";
import { aiUsage } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import type { Member } from "@/lib/auth";
import { MODELS, NO_USAGE, type AiUsage } from "./models";

/** Paid AI calls (extraction and Find more together), over rolling windows. The only place to change them. */
export const AI_LIMITS = { perUserPerHour: 30, perAgencyPerDay: 300 } as const;

export const USER_HOURLY_LIMIT_ERROR = "You've hit the hourly limit for AI lookups. Try again later.";
export const AGENCY_DAILY_LIMIT_ERROR = "Your agency has hit today's limit for AI lookups. Try again tomorrow.";

export type AiPurpose = "extraction" | "find_more";

/**
 * Returns the error to show when the member or their agency is at a limit, otherwise null. Run it
 * right before the model call. Two calls racing past the check can both run; the limit is a cost
 * guard, not an exact quota.
 */
export async function aiLimitError(member: Member): Promise<string | null> {
  return withAgency(member.agencyId, async (tx) => {
    const [user] = await tx
      .select({ n: count() })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, member.userId), gt(aiUsage.createdAt, sql`now() - interval '1 hour'`)));
    if (user.n >= AI_LIMITS.perUserPerHour) return USER_HOURLY_LIMIT_ERROR;
    const [agency] = await tx
      .select({ n: count() })
      .from(aiUsage)
      .where(gt(aiUsage.createdAt, sql`now() - interval '24 hours'`));
    if (agency.n >= AI_LIMITS.perAgencyPerDay) return AGENCY_DAILY_LIMIT_ERROR;
    return null;
  });
}

/** Records one paid call, success or failure. */
export async function recordAiUsage(member: Member, purpose: AiPurpose, usage: AiUsage = NO_USAGE): Promise<void> {
  await withAgency(member.agencyId, (tx) =>
    tx.insert(aiUsage).values({
      agencyId: member.agencyId,
      userId: member.userId,
      purpose,
      model: MODELS.extract,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      webSearches: usage.webSearches,
    }),
  );
}

/**
 * Runs one paid call: checks the limits first, then always records a usage row (0s when the call
 * failed before usage was known). Returns the limit error instead of calling when over a limit.
 */
export async function meteredAiCall<T>(
  member: Member,
  purpose: AiPurpose,
  call: (onUsage: (u: AiUsage) => void) => Promise<T>,
): Promise<{ limited: string } | { value: T }> {
  const limited = await aiLimitError(member);
  if (limited) return { limited };
  let usage: AiUsage = NO_USAGE;
  try {
    return { value: await call((u) => (usage = u)) };
  } finally {
    await recordAiUsage(member, purpose, usage);
  }
}
