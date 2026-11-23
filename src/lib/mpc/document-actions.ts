"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { mpcDocuments, mpcFacts, mpcRestrictions, mpcs } from "@/db/schema";
import { isCheckViolation } from "@/db/errors";
import { withAgency } from "@/db/with-agency";
import { requireMember, type Member } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  cleanFields,
  cleanRestrictions,
  EXTRACTABLE_FIELDS,
  extractProfile,
  verifyFacts,
  type DraftFact,
  type ProfileDraft,
} from "@/lib/ai/extract-profile";
import { getGenerate } from "@/lib/ai/models";
import { meteredAiCall } from "@/lib/ai/usage";
import { draftSigningConfigured, signDraft, verifyDraft } from "./draft-signing";
import { toSources } from "./document-queries";
import { BAD_KIND, isDocKind, NO_INPUT, prepareFile, preparePaste, storeUpload } from "./document-input";
import { cleanFactText } from "./fact-text";
import { isUuid } from "./queries";
import { mpcDraftInput, mpcInput, type MpcInput } from "./schema";

export type { DocKind } from "./document-input";
export type AddDocumentResult = { ok: true; documentId: string } | { ok: false; error: string };
export type ExtractionResult =
  | { ok: true; draft: ProfileDraft; issuedAt: number; signature: string }
  | { ok: false; error: string };
/** activated is set when the accepted fields completed a draft and it became active. */
export type ApplyResult = { ok: true; activated?: true } | { ok: false; error: string };

/** What the reviewer accepted. The draft is sent back and re-checked against the stored documents. */
export type AcceptedExtraction = {
  draft: ProfileDraft;
  /** From runExtraction. The draft cannot be edited or extended after signing. */
  issuedAt: number;
  signature: string;
  fields: Partial<MpcInput>;
  factIndexes: number[];
  restrictionIndexes: number[];
};

const NOT_FOUND = "MPC not found.";
const NOT_YOURS = "You can only edit your own MPCs.";
const NOT_CONFIGURED = "Extraction is not configured yet.";
const STALE = "This review is out of date. Run the extraction again.";
const NO_DOCS = "Add a resume, notes or a transcript first.";
const EXTRACT_FAILED = "The extraction did not finish. Try again.";
const CHANGED = "This MPC changed. Reload and try again.";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Reads the MPC owner and checks the member may edit it. Returns an error string or null. */
async function authorize(member: Member, mpcId: string): Promise<string | null> {
  if (!isUuid(mpcId)) return NOT_FOUND;
  const [row] = await withAgency(member.agencyId, (tx) =>
    tx.select({ ownerUserId: mpcs.ownerUserId }).from(mpcs).where(eq(mpcs.id, mpcId)),
  );
  if (!row) return NOT_FOUND;
  return can(member, "mpc.edit", { ownerUserId: row.ownerUserId }) ? null : NOT_YOURS;
}

/**
 * Adds a resume, notes or transcript to an MPC. formData carries kind plus either a file or
 * pastedText (and an optional name for pasted text). Uploaded originals go to file storage;
 * pasted text is kept as text only. The extracted text is stored on the document.
 */
export async function addDocument(mpcId: string, formData: FormData): Promise<AddDocumentResult> {
  const member = await requireMember();
  const denied = await authorize(member, mpcId);
  if (denied) return fail(denied);

  const kind = formData.get("kind");
  if (!isDocKind(kind)) return fail(BAD_KIND);

  const file = formData.get("file");
  const pasted = formData.get("pastedText");
  let prepared;
  if (file instanceof File && file.size > 0) prepared = await prepareFile(kind, file);
  else if (typeof pasted === "string" && pasted.trim() !== "") prepared = preparePaste(kind, pasted, formData.get("name"));
  else return fail(NO_INPUT);
  if (!prepared.ok) return fail(prepared.error);
  const source = prepared.source;
  const stored = await storeUpload(source);
  if (!stored.ok) return fail(stored.error);

  const [row] = await withAgency(member.agencyId, (tx) =>
    tx
      .insert(mpcDocuments)
      .values({
        agencyId: member.agencyId,
        mpcId,
        kind: source.kind,
        blobUrl: stored.blobUrl,
        filename: source.filename,
        text: source.text,
        createdBy: member.userId,
      })
      .returning({ id: mpcDocuments.id }),
  );
  revalidatePath(`/mpcs/${mpcId}`);
  return { ok: true, documentId: row.id };
}

async function loadSources(member: Member, mpcId: string) {
  const docs = await withAgency(member.agencyId, (tx) =>
    tx
      .select({ id: mpcDocuments.id, kind: mpcDocuments.kind, filename: mpcDocuments.filename, text: mpcDocuments.text })
      .from(mpcDocuments)
      .where(eq(mpcDocuments.mpcId, mpcId))
      .orderBy(mpcDocuments.createdAt, mpcDocuments.id),
  );
  return toSources(docs);
}

/** Reads the MPC's documents and proposes a profile for review. Saves nothing. */
export async function runExtraction(mpcId: string): Promise<ExtractionResult> {
  const member = await requireMember();
  if (!draftSigningConfigured()) return fail(NOT_CONFIGURED);
  const denied = await authorize(member, mpcId);
  if (denied) return fail(denied);
  const sources = await loadSources(member, mpcId);
  if (sources.length === 0) return fail(NO_DOCS);
  try {
    const run = await meteredAiCall(member, "extraction", (onUsage) =>
      extractProfile(sources, { generate: getGenerate(), onUsage }),
    );
    if ("limited" in run) return fail(run.limited);
    const draft = run.value;
    const issuedAt = Date.now();
    return { ok: true, draft, issuedAt, signature: signDraft({ mpcId, userId: member.userId, issuedAt, draft }) };
  } catch (err) {
    // Log the reason only, never the document text.
    console.error("Profile extraction failed:", err instanceof Error ? err.message : "unknown error");
    return fail(EXTRACT_FAILED);
  }
}

const validIndexes = (v: unknown, length: number): number[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < length))].sort((a, b) => a - b)
    : [];

/**
 * Writes only what the reviewer accepted. Facts are re-checked against the stored documents (the
 * quote must be in its source) and their status comes from the source kind: resume facts are
 * usable, notes and transcript facts are interview only. Accepted fields are merged into the MPC
 * and validated like a normal profile edit. Pay fields are never written here.
 */
export async function applyExtraction(mpcId: string, accepted: AcceptedExtraction): Promise<ApplyResult> {
  const member = await requireMember();
  const denied = await authorize(member, mpcId);
  if (denied) return fail(denied);

  if (!draftSigningConfigured()) return fail(NOT_CONFIGURED);
  const draft = accepted?.draft;
  if (!draft || !verifyDraft({ mpcId, userId: member.userId, issuedAt: accepted.issuedAt, draft }, accepted.signature)) {
    return fail(STALE);
  }
  const draftFacts: DraftFact[] = Array.isArray(draft?.facts) ? draft.facts : [];
  const draftRestrictions = cleanRestrictions(draft?.restrictionsSuggested);
  const fields = cleanFields(accepted?.fields);
  // Accepted fields must be exactly the signed proposals: the client may pick, never change.
  const sentFields = (accepted.fields ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(sentFields)) {
    if (sentFields[k] == null) continue;
    if (JSON.stringify(sentFields[k]) !== JSON.stringify((draft.fields as Record<string, unknown> | undefined)?.[k])) {
      return fail(STALE);
    }
  }
  // A field the reviewer accepted that does not pass the basic checks is an error, not a silent skip.
  const sent = (accepted?.fields ?? {}) as Record<string, unknown>;
  if (EXTRACTABLE_FIELDS.some((k) => sent[k] != null && !(k in fields))) {
    return fail("One of the profile fields is not valid. Check the fields and try again.");
  }
  const factIndexes = validIndexes(accepted?.factIndexes, draftFacts.length);
  const restrictionIndexes = validIndexes(accepted?.restrictionIndexes, draftRestrictions.length);

  const sources = await loadSources(member, mpcId);
  const documentIdOf = new Map(sources.map((s) => [s.ref, s.documentId ?? null]));
  // Same text rules as a fact typed by hand. A fact that fails them is dropped, not the whole save.
  const facts = verifyFacts(
    factIndexes.map((i) => draftFacts[i]),
    sources,
  ).flatMap((f) => {
    const clean = cleanFactText(f.text);
    return clean.ok ? [{ ...f, text: clean.text }] : [];
  });
  const restrictions = restrictionIndexes.map((i) => draftRestrictions[i]);

  let result: ApplyResult;
  try {
    result = await withAgency(member.agencyId, async (tx): Promise<ApplyResult> => {
      // Locked so a concurrent status change cannot slip between this read and the writes below.
      const [current] = await tx.select().from(mpcs).where(eq(mpcs.id, mpcId)).for("update");
      if (!current) return fail(NOT_FOUND);

      // Validate the merged profile before any write. A draft may still lack headline role and location.
      const isDraft = current.status === "draft";
      let merged: ReturnType<typeof mpcDraftInput.parse> | null = null;
      if (Object.keys(fields).length > 0) {
        const parsed = (isDraft ? mpcDraftInput : mpcInput).safeParse({
          headlineRole: current.headlineRole,
          location: current.location,
          yearsExperience: current.yearsExperience,
          seniority: current.seniority,
          specialtyTags: current.specialtyTags,
          workMode: current.workMode,
          employerType: current.employerType,
          targetCities: current.targetCities,
          payFloor: current.payFloor,
          payFloorStrict: current.payFloorStrict,
          payTarget: current.payTarget,
          overlapPriority: current.overlapPriority,
          ...fields,
        });
        if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the fields and try again.");
        merged = parsed.data;
      }

      // A draft that now has both headline role and location becomes active in this same transaction.
      const activated = isDraft && merged !== null && merged.headlineRole !== null && merged.location !== null;
      if (merged) {
        await tx
          .update(mpcs)
          .set({ ...merged, ...(activated ? { status: "active" as const } : {}), updatedAt: new Date() })
          .where(eq(mpcs.id, mpcId));
      }

      if (facts.length > 0) {
        const have = new Set(
          (await tx.select({ text: mpcFacts.text }).from(mpcFacts).where(eq(mpcFacts.mpcId, mpcId))).map((r) =>
            r.text.trim().toLowerCase(),
          ),
        );
        const fresh = facts.filter((f) => {
          const key = f.text.toLowerCase();
          if (have.has(key)) return false;
          have.add(key);
          return true;
        });
        if (fresh.length > 0) {
          await tx.insert(mpcFacts).values(
            fresh.map((f) => ({
              agencyId: member.agencyId,
              mpcId,
              text: f.text,
              sourceKind: f.sourceKind,
              sourceRef: f.sourceRef,
              sourceDocumentId: documentIdOf.get(f.sourceRef) ?? null,
              sourceQuote: f.sourceQuote,
              status: f.sourceKind === "resume" ? ("usable" as const) : ("interview_only" as const),
            })),
          );
        }
      }

      if (restrictions.length > 0) {
        const have = new Set(
          (await tx.select({ kind: mpcRestrictions.kind, value: mpcRestrictions.value }).from(mpcRestrictions).where(eq(mpcRestrictions.mpcId, mpcId))).map(
            (r) => `${r.kind}:${r.value.toLowerCase()}`,
          ),
        );
        const fresh = restrictions.filter((r) => {
          const key = `${r.kind}:${r.value.toLowerCase()}`;
          if (have.has(key)) return false;
          have.add(key);
          return true;
        });
        if (fresh.length > 0) {
          await tx.insert(mpcRestrictions).values(fresh.map((r) => ({ agencyId: member.agencyId, mpcId, kind: r.kind, value: r.value })));
        }
      }
      return activated ? { ok: true, activated: true } : { ok: true };
    });
  } catch (err) {
    // The database refused a status without role and location: the row changed under us.
    if (isCheckViolation(err)) return fail(CHANGED);
    throw err;
  }
  if (result.ok) {
    revalidatePath("/mpcs");
    revalidatePath(`/mpcs/${mpcId}`);
  }
  return result;
}
