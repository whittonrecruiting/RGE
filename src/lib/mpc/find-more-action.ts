"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { mpcFacts, mpcs } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { requireMember, type Member } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cleanFoundFacts, findMore, MAX_HINTS_CHARS, type FoundFact } from "@/lib/ai/find-more";
import { getGenerate } from "@/lib/ai/models";
import { draftSigningConfigured, signDraft, verifyDraft } from "./draft-signing";
import { cleanFactText } from "./fact-text";
import { isUuid } from "./queries";

/** What a search proposes. The kind keeps it from being mistaken for a profile extraction draft. */
export type FindMoreDraft = { kind: "find_more"; facts: FoundFact[] };
export type FindMoreResult =
  | { ok: true; draft: FindMoreDraft; issuedAt: number; signature: string }
  | { ok: false; error: string };
export type ApplyFindMoreResult = { ok: true } | { ok: false; error: string };
export type AcceptedFindMore = { draft: FindMoreDraft; issuedAt: number; signature: string; factIndexes: number[] };

const NOT_FOUND = "MPC not found.";
const NOT_YOURS = "You can only edit your own MPCs.";
const NOT_CONFIGURED = "Find more is not configured yet.";
const STALE = "This review is out of date. Run the search again.";
const SEARCH_FAILED = "The search did not finish. Try again.";
const HINTS_TOO_LONG = `Keep the details under ${MAX_HINTS_CHARS} characters.`;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

type Loaded = { ownerUserId: string; headlineRole: string; location: string; specialtyTags: string[] };

async function authorize(member: Member, mpcId: string): Promise<{ error: string } | { mpc: Loaded }> {
  if (!isUuid(mpcId)) return { error: NOT_FOUND };
  const [row] = await withAgency(member.agencyId, (tx) =>
    tx
      .select({
        ownerUserId: mpcs.ownerUserId,
        headlineRole: mpcs.headlineRole,
        location: mpcs.location,
        specialtyTags: mpcs.specialtyTags,
      })
      .from(mpcs)
      .where(eq(mpcs.id, mpcId)),
  );
  if (!row) return { error: NOT_FOUND };
  return can(member, "mpc.edit", { ownerUserId: row.ownerUserId }) ? { mpc: row } : { error: NOT_YOURS };
}

const validIndexes = (v: unknown, length: number): number[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < length))].sort((a, b) => a - b)
    : [];

/**
 * Searches the public web for more facts about the MPC and returns them signed for review.
 * Saves nothing. The hints go to the model only: they are not stored, logged or signed.
 */
export async function runFindMore(mpcId: string, hints: string): Promise<FindMoreResult> {
  const member = await requireMember();
  if (!draftSigningConfigured()) return fail(NOT_CONFIGURED);
  const auth = await authorize(member, mpcId);
  if ("error" in auth) return fail(auth.error);
  const hintText = typeof hints === "string" ? hints : "";
  if (hintText.length > MAX_HINTS_CHARS) return fail(HINTS_TOO_LONG);

  const known = await withAgency(member.agencyId, (tx) =>
    tx.select({ text: mpcFacts.text }).from(mpcFacts).where(eq(mpcFacts.mpcId, mpcId)),
  );
  try {
    const { facts } = await findMore(
      {
        headlineRole: auth.mpc.headlineRole,
        location: auth.mpc.location,
        specialtyTags: auth.mpc.specialtyTags,
        facts: known.map((k) => k.text),
      },
      hintText,
      { generate: getGenerate() },
    );
    const draft: FindMoreDraft = { kind: "find_more", facts };
    const issuedAt = Date.now();
    return { ok: true, draft, issuedAt, signature: signDraft({ mpcId, userId: member.userId, issuedAt, draft }) };
  } catch (err) {
    // Reason only. Never the hints or the model output.
    console.error("Find more failed:", err instanceof Error ? err.message : "unknown error");
    return fail(SEARCH_FAILED);
  }
}

/** Saves the facts the reviewer picked (by index into the signed draft) as usable web facts. */
export async function applyFindMore(mpcId: string, accepted: AcceptedFindMore): Promise<ApplyFindMoreResult> {
  const member = await requireMember();
  const auth = await authorize(member, mpcId);
  if ("error" in auth) return fail(auth.error);
  if (!draftSigningConfigured()) return fail(NOT_CONFIGURED);

  const draft = accepted?.draft;
  if (!draft || !verifyDraft({ mpcId, userId: member.userId, issuedAt: accepted.issuedAt, draft }, accepted.signature)) {
    return fail(STALE);
  }
  if (draft.kind !== "find_more" || !Array.isArray(draft.facts)) return fail(STALE);
  // Defence in depth: signed content is re-checked against the same rules before it is written.
  const draftFacts = cleanFoundFacts(draft.facts);
  if (draftFacts.length !== draft.facts.length) return fail(STALE);
  // Same text rules as a fact typed by hand. A fact that fails them is dropped, not the whole save.
  const chosen = validIndexes(accepted.factIndexes, draftFacts.length).flatMap((i) => {
    const clean = cleanFactText(draftFacts[i].text);
    return clean.ok ? [{ ...draftFacts[i], text: clean.text }] : [];
  });

  const result = await withAgency(member.agencyId, async (tx): Promise<ApplyFindMoreResult> => {
    const existing = await tx
      .select({ text: mpcFacts.text, sourceRef: mpcFacts.sourceRef })
      .from(mpcFacts)
      .where(eq(mpcFacts.mpcId, mpcId));
    const key = (text: string, url: string | null) => `${text.trim().toLowerCase()}\n${url ?? ""}`;
    const have = new Set(existing.map((r) => key(r.text, r.sourceRef)));
    const fresh = chosen.filter((f) => {
      const k = key(f.text, f.url);
      if (have.has(k)) return false;
      have.add(k);
      return true;
    });
    if (fresh.length > 0) {
      await tx.insert(mpcFacts).values(
        fresh.map((f) => ({
          agencyId: member.agencyId,
          mpcId,
          text: f.text,
          sourceKind: "web" as const,
          sourceRef: f.url,
          sourceQuote: f.quote,
          status: "usable" as const,
        })),
      );
    }
    return { ok: true };
  });
  if (result.ok) {
    revalidatePath("/mpcs");
    revalidatePath(`/mpcs/${mpcId}`);
  }
  return result;
}
