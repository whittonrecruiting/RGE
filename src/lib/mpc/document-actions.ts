"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { mpcDocuments, mpcFacts, mpcRestrictions, mpcs } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { requireMember, type Member } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { extractText, MAX_FILE_BYTES } from "@/lib/docs/text";
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
import { putFile } from "@/lib/storage";
import { draftSigningConfigured, signDraft, verifyDraft } from "./draft-signing";
import { toSources } from "./document-queries";
import { isUuid } from "./queries";
import { mpcInput, type MpcInput } from "./schema";

export type DocKind = "resume" | "notes" | "transcript";
export type AddDocumentResult = { ok: true; documentId: string } | { ok: false; error: string };
export type ExtractionResult =
  | { ok: true; draft: ProfileDraft; issuedAt: number; signature: string }
  | { ok: false; error: string };
export type ApplyResult = { ok: true } | { ok: false; error: string };

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
const BAD_KIND = "Choose resume, notes or transcript.";
const NO_INPUT = "Paste some text or choose a file.";
const TOO_LONG = "That text is too long. Paste up to 200,000 characters.";
const NOT_CONFIGURED = "Extraction is not configured yet.";
const STALE = "This review is out of date. Run the extraction again.";
const NO_DOCS = "Add a resume, notes or a transcript first.";
const EXTRACT_FAILED = "The extraction did not finish. Try again.";
const MAX_PASTED = 200_000;
const MAX_FILENAME = 200;

const KINDS: readonly DocKind[] = ["resume", "notes", "transcript"];
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
  if (typeof kind !== "string" || !KINDS.includes(kind as DocKind)) return fail(BAD_KIND);

  const file = formData.get("file");
  const pasted = formData.get("pastedText");
  let filename: string;
  let text: string;
  let blobUrl: string | null = null;

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return fail("File is larger than 10 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await extractText({ name: file.name, type: file.type, bytes });
    if (!result.ok) return fail(result.error);
    try {
      blobUrl = (await putFile(file.name, bytes, file.type || "application/octet-stream")).url;
    } catch (err) {
      return fail(err instanceof Error ? err.message : "The file could not be saved. Try again.");
    }
    filename = file.name.slice(0, MAX_FILENAME);
    text = result.text;
  } else if (typeof pasted === "string" && pasted.trim() !== "") {
    if (pasted.length > MAX_PASTED) return fail(TOO_LONG);
    const name = formData.get("name");
    filename = (typeof name === "string" && name.trim() !== "" ? name.trim() : `Pasted ${kind}`).slice(0, MAX_FILENAME);
    text = pasted;
  } else {
    return fail(NO_INPUT);
  }

  const [row] = await withAgency(member.agencyId, (tx) =>
    tx
      .insert(mpcDocuments)
      .values({
        agencyId: member.agencyId,
        mpcId,
        kind: kind as DocKind,
        blobUrl,
        filename,
        text,
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
      .select({ kind: mpcDocuments.kind, filename: mpcDocuments.filename, text: mpcDocuments.text })
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
    const draft = await extractProfile(sources, { generate: getGenerate() });
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
  const facts = verifyFacts(
    factIndexes.map((i) => draftFacts[i]),
    sources,
  );
  const restrictions = restrictionIndexes.map((i) => draftRestrictions[i]);

  const result = await withAgency(member.agencyId, async (tx): Promise<ApplyResult> => {
    const [current] = await tx.select().from(mpcs).where(eq(mpcs.id, mpcId));
    if (!current) return fail(NOT_FOUND);

    // Validate the merged profile before any write.
    let merged: ReturnType<typeof mpcInput.parse> | null = null;
    if (Object.keys(fields).length > 0) {
      const parsed = mpcInput.safeParse({
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

    if (merged) await tx.update(mpcs).set({ ...merged, updatedAt: new Date() }).where(eq(mpcs.id, mpcId));

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
    return { ok: true };
  });
  if (result.ok) {
    revalidatePath("/mpcs");
    revalidatePath(`/mpcs/${mpcId}`);
  }
  return result;
}
