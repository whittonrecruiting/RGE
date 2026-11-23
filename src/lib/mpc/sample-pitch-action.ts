"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { mpcFacts, mpcRestrictions, mpcSavedBullets, mpcs } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import type { Tx } from "@/db/client";
import { requireMember, type Member } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getGenerate } from "@/lib/ai/models";
import { meteredAiCall } from "@/lib/ai/usage";
import {
  backgroundPasses,
  draftPitchParts,
  renderPitch,
  screenBullets,
  TEMPLATE_BULLETS_ERROR,
  type PitchBullet,
  type SamplePitch,
} from "@/lib/ai/sample-pitch";
import { getSettings } from "@/lib/settings/get";
import { checkBullet, restrictedTerm, strongFactsMessage } from "./pitch-guard";
import { isUuid, STRONG_FACT_STATUSES } from "./queries";

export type SamplePitchResult = { ok: true; pitch: SamplePitch } | { ok: false; error: string };
export type SaveBulletsResult = { ok: true } | { ok: false; error: string };
/**
 * swapPosition: write a new bullet from a different fact for that position (1 to 3), keeping the
 * others. keep: the bullets currently on screen, in position order; when given they are kept
 * (after the same checks) instead of the saved bullets.
 */
export type SamplePitchOptions = { swapPosition?: 1 | 2 | 3; keep?: PitchBullet[] };

const NOT_FOUND = "MPC not found.";
const NOT_YOURS = "You can only edit your own MPCs.";
const ACTIVATE = "Activate this MPC before previewing a pitch.";
const RESTORE = "Restore this MPC before previewing a pitch.";
const PLACED = "This MPC is placed.";
const FAILED = "The sample pitch did not finish. Try again.";
const NO_SWAP = "No other strong fact to swap in. Confirm a note or run Find more.";
const BAD_SWAP = "Choose bullet 1, 2 or 3 to swap.";
const EXACTLY_THREE = "Choose exactly three bullets.";
const BACKGROUND_WARNING = "The background phrase did not pass the checks. Regenerate to try again.";
const POSITIONS = [1, 2, 3] as const;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

type Loaded = { ownerUserId: string; status: string; headlineRole: string | null; location: string | null };

/** Loads the MPC (optionally locked) and checks the member may edit it. */
async function authorize(member: Member, tx: Tx, mpcId: string, lock = false): Promise<{ error: string } | { mpc: Loaded }> {
  const q = tx
    .select({ ownerUserId: mpcs.ownerUserId, status: mpcs.status, headlineRole: mpcs.headlineRole, location: mpcs.location })
    .from(mpcs)
    .where(eq(mpcs.id, mpcId));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) return { error: NOT_FOUND };
  return can(member, "mpc.edit", { ownerUserId: row.ownerUserId }) ? { mpc: row } : { error: NOT_YOURS };
}

async function restrictedTerms(tx: Tx, mpcId: string): Promise<string[]> {
  const rows = await tx
    .select({ value: mpcRestrictions.value })
    .from(mpcRestrictions)
    .where(and(eq(mpcRestrictions.mpcId, mpcId), inArray(mpcRestrictions.kind, ["never_say", "confidential"])));
  return rows.map((r) => r.value);
}

function refresh(mpcId: string) {
  revalidatePath("/mpcs");
  revalidatePath(`/mpcs/${mpcId}`);
}

const isBulletShape = (b: unknown): b is PitchBullet =>
  !!b && typeof (b as PitchBullet).factId === "string" && typeof (b as PitchBullet).text === "string";

/**
 * Drafts an example pitch from the MPC's usable and confirmed facts with the agency pitch
 * template. Never sends or saves anything. Saved bullets (or the bullets passed in keep) are used
 * as they are; only empty positions and the swapped position get new bullets from the model.
 * Every bullet passes the draft guard against its own fact or is dropped.
 */
export async function generateSamplePitch(mpcId: string, opts: SamplePitchOptions = {}): Promise<SamplePitchResult> {
  const member = await requireMember();
  if (!isUuid(mpcId)) return fail(NOT_FOUND);
  const swap = opts?.swapPosition;
  if (swap !== undefined && !POSITIONS.includes(swap)) return fail(BAD_SWAP);

  const loaded = await withAgency(member.agencyId, async (tx) => {
    const auth = await authorize(member, tx, mpcId);
    if ("error" in auth) return auth;
    const facts = await tx
      .select({ id: mpcFacts.id, text: mpcFacts.text })
      .from(mpcFacts)
      .where(and(eq(mpcFacts.mpcId, mpcId), inArray(mpcFacts.status, [...STRONG_FACT_STATUSES])))
      .orderBy(asc(mpcFacts.createdAt), asc(mpcFacts.id));
    const saved = await tx
      .select({ position: mpcSavedBullets.position, factId: mpcSavedBullets.factId, text: mpcSavedBullets.text })
      .from(mpcSavedBullets)
      .where(eq(mpcSavedBullets.mpcId, mpcId))
      .orderBy(asc(mpcSavedBullets.position));
    return { mpc: auth.mpc, facts, saved, restricted: await restrictedTerms(tx, mpcId) };
  });
  if ("error" in loaded) return fail(loaded.error);
  const { mpc, facts, saved, restricted } = loaded;
  if (mpc.status === "removed") return fail(RESTORE);
  if (mpc.status === "placed") return fail(PLACED);
  if (mpc.status === "draft" || mpc.headlineRole === null || mpc.location === null) return fail(ACTIVATE);

  const settings = await getSettings(member.agencyId);
  if (settings.templates.pitch.split("[bullet]").length - 1 !== 3) return fail(TEMPLATE_BULLETS_ERROR);

  // Bullets to keep: the ones on screen when given, otherwise the saved ones. Rechecked here.
  const eligible = new Map(facts.map((f) => [f.id, f.text]));
  const source =
    Array.isArray(opts?.keep) && opts.keep.length > 0
      ? opts.keep
          .slice(0, 3)
          // Only factId and text from the client; the position is the index.
          .flatMap((b, i) => (isBulletShape(b) ? [{ position: i + 1, factId: b.factId, text: b.text }] : []))
      : saved;
  const kept = new Map<number, PitchBullet>();
  for (const b of source) {
    if (b.position === swap || kept.has(b.position)) continue;
    const factText = eligible.get(b.factId);
    if (factText === undefined || [...kept.values()].some((k) => k.factId === b.factId)) continue;
    if (checkBullet(b.text, factText) !== null || restrictedTerm(b.text, restricted) !== null) continue;
    kept.set(b.position, { factId: b.factId, text: b.text.trim() });
  }
  const swappedOut = swap === undefined ? undefined : source.find((b) => b.position === swap)?.factId;
  const keptFacts = new Set([...kept.values()].map((b) => b.factId));
  const available = facts.filter((f) => !keptFacts.has(f.id) && f.id !== swappedOut);
  const open = POSITIONS.filter((p) => !kept.has(p));
  if (swap !== undefined && available.length === 0) return fail(NO_SWAP);
  // Nothing to keep and nothing to write from: no paid call, just say why.
  if (kept.size === 0 && available.length === 0) return fail(strongFactsMessage(facts.length));

  let parts: { background: string; bullets: PitchBullet[] };
  try {
    const run = await meteredAiCall(member, "sample_pitch", (onUsage) =>
      draftPitchParts(
        {
          headlineRole: mpc.headlineRole!,
          location: mpc.location!,
          facts: available,
          kept: POSITIONS.flatMap((p) => (kept.has(p) ? [kept.get(p)!.text] : [])),
          count: Math.min(open.length, available.length),
        },
        { generate: getGenerate(), onUsage },
      ),
    );
    if ("limited" in run) return fail(run.limited);
    parts = run.value;
  } catch (err) {
    // Reason only. Never the facts or the model output.
    console.error("Sample pitch failed:", err instanceof Error ? err.message : "unknown error");
    return fail(FAILED);
  }

  const fresh = screenBullets(parts.bullets, new Map(available.map((f) => [f.id, f.text])), restricted, open.length);
  // Positions in order, kept bullets where they were; a gap closes up so bullets[i] is line i + 1.
  const bullets = POSITIONS.flatMap((p) => {
    const b = kept.get(p) ?? fresh.shift();
    return b ? [b] : [];
  });
  const used = bullets.map((b) => eligible.get(b.factId)!);
  // A background phrase stands on the facts the bullets use; with none used it has no backing.
  const background = used.length > 0 && backgroundPasses(parts.background, used, restricted) ? parts.background : null;

  const warnings: string[] = [];
  if (bullets.length < 3) {
    warnings.push(
      facts.length < 3
        ? strongFactsMessage(facts.length)
        : `Only ${bullets.length} ${bullets.length === 1 ? "bullet" : "bullets"} passed the checks. Regenerate to try again.`,
    );
  }
  if (background === null) warnings.push(BACKGROUND_WARNING);

  const rendered = renderPitch({
    template: settings.templates.pitch,
    optOut: settings.templates.optOut,
    headlineRole: mpc.headlineRole,
    location: mpc.location,
    background,
    bullets: POSITIONS.map((_, i) => bullets[i]?.text ?? null),
  });
  if (!rendered.ok) return fail(rendered.error);
  return { ok: true, pitch: { subject: rendered.subject, body: rendered.body, bullets, warnings } };
}

/**
 * Saves the recruiter's preferred three bullets ("Use these bullets"), replacing any saved before.
 * Each bullet is checked again against its stored fact, which must be usable or confirmed.
 */
export async function saveBullets(mpcId: string, bullets: PitchBullet[]): Promise<SaveBulletsResult> {
  const member = await requireMember();
  if (!isUuid(mpcId)) return fail(NOT_FOUND);
  if (!Array.isArray(bullets) || bullets.length !== 3 || !bullets.every(isBulletShape)) return fail(EXACTLY_THREE);
  const ids = bullets.map((b) => b.factId);
  if (!ids.every(isUuid)) return fail(EXACTLY_THREE);
  if (new Set(ids).size !== 3) return fail("Use a different fact for each bullet.");

  const result = await withAgency(member.agencyId, async (tx): Promise<SaveBulletsResult> => {
    // Locks: the MPC serializes two saves; each fact so an edit cannot slip in after the check
    // (updateFact clears saved bullets after taking the fact's row lock).
    const auth = await authorize(member, tx, mpcId, true);
    if ("error" in auth) return fail(auth.error);
    if (auth.mpc.status === "draft") return fail(ACTIVATE);
    const rows = await tx
      .select({ id: mpcFacts.id, text: mpcFacts.text, status: mpcFacts.status })
      .from(mpcFacts)
      .where(and(eq(mpcFacts.mpcId, mpcId), inArray(mpcFacts.id, ids)))
      .for("share");
    const restricted = await restrictedTerms(tx, mpcId);
    for (const [i, b] of bullets.entries()) {
      const fact = rows.find((r) => r.id === b.factId);
      if (!fact || fact.status === "interview_only") {
        return fail(`Bullet ${i + 1}: its fact changed or still needs a confirm. Regenerate the pitch.`);
      }
      const problem = checkBullet(b.text, fact.text);
      if (problem) return fail(`Bullet ${i + 1}: ${problem}`);
      if (restrictedTerm(b.text, restricted)) return fail(`Bullet ${i + 1} uses a term on the restrictions list.`);
    }
    await tx.delete(mpcSavedBullets).where(eq(mpcSavedBullets.mpcId, mpcId));
    await tx.insert(mpcSavedBullets).values(
      bullets.map((b, i) => ({
        agencyId: member.agencyId,
        mpcId,
        factId: b.factId,
        position: i + 1,
        text: b.text.trim(),
        createdBy: member.userId,
      })),
    );
    return { ok: true };
  });
  if (result.ok) refresh(mpcId);
  return result;
}

/** Clears the saved bullets, so the next sample pitch picks all three again. */
export async function clearSavedBullets(mpcId: string): Promise<SaveBulletsResult> {
  const member = await requireMember();
  if (!isUuid(mpcId)) return fail(NOT_FOUND);
  const result = await withAgency(member.agencyId, async (tx): Promise<SaveBulletsResult> => {
    const auth = await authorize(member, tx, mpcId, true);
    if ("error" in auth) return fail(auth.error);
    await tx.delete(mpcSavedBullets).where(eq(mpcSavedBullets.mpcId, mpcId));
    return { ok: true };
  });
  if (result.ok) refresh(mpcId);
  return result;
}
