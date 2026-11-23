"use server";

import { revalidatePath } from "next/cache";
import { mpcDocuments, mpcs } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { MAX_SOURCES, MAX_TOTAL_BYTES, TOO_BIG_TOGETHER, TOO_MANY } from "./build-limits";
import { prepareFile, preparePaste, storeUpload, type PreparedSource } from "./document-input";

export type DocumentError = { name: string; error: string };
export type BuildProfileResult =
  | { ok: true; mpcId: string; documentErrors: DocumentError[] }
  | { ok: false; error: string };

const NOTHING_VALID = "Add at least one resume, notes or transcript.";
const NOT_YOURS = "You can only edit your own MPCs.";

type RawSource = { kind: unknown } & ({ file: File } | { paste: string; label: string });

/**
 * FormData carries `file` and `paste` entries in order, each followed by the `kind` it was given
 * (resume, notes or transcript): the nth kind belongs to the nth source. Empty paste boxes and empty
 * file inputs are skipped.
 */
function readSources(formData: FormData): RawSource[] {
  const kinds = formData.getAll("kind");
  const sources: RawSource[] = [];
  let index = 0;
  let pastes = 0;
  for (const [key, value] of formData.entries()) {
    if (key !== "file" && key !== "paste") continue;
    const kind = kinds[index++];
    if (key === "file") {
      if (value instanceof File && (value.size > 0 || value.name !== "")) sources.push({ kind, file: value });
    } else if (typeof value === "string") {
      pastes++;
      if (value.trim() !== "") sources.push({ kind, paste: value, label: `Pasted text ${pastes}` });
    }
  }
  return sources;
}

/**
 * Starts a draft MPC from the recruiter's documents. Every source is checked by the same rules as
 * addDocument; a bad source is reported in documentErrors and the good ones are kept. The draft and
 * its documents are written in one transaction, and only when at least one source is good.
 */
export async function buildProfile(formData: FormData): Promise<BuildProfileResult> {
  const member = await requireMember();
  if (!can(member, "mpc.edit", { ownerUserId: member.userId })) return { ok: false, error: NOT_YOURS };

  const raw = readSources(formData);
  if (raw.length > MAX_SOURCES) return { ok: false, error: TOO_MANY };
  const total = raw.reduce((sum, s) => sum + ("file" in s ? s.file.size : s.paste.length), 0);
  if (total > MAX_TOTAL_BYTES) return { ok: false, error: TOO_BIG_TOGETHER };

  const documentErrors: DocumentError[] = [];
  const ready: (PreparedSource & { blobUrl: string | null })[] = [];
  for (const s of raw) {
    const name = "file" in s ? s.file.name.slice(0, 200) : s.label;
    const prepared = "file" in s ? await prepareFile(s.kind, s.file) : preparePaste(s.kind, s.paste);
    if (!prepared.ok) {
      documentErrors.push({ name, error: prepared.error });
      continue;
    }
    const stored = await storeUpload(prepared.source);
    if (!stored.ok) {
      documentErrors.push({ name, error: stored.error });
      continue;
    }
    ready.push({ ...prepared.source, blobUrl: stored.blobUrl });
  }
  if (ready.length === 0) return { ok: false, error: NOTHING_VALID };

  const mpcId = await withAgency(member.agencyId, async (tx) => {
    const [row] = await tx
      .insert(mpcs)
      .values({ agencyId: member.agencyId, ownerUserId: member.userId, status: "draft" })
      .returning({ id: mpcs.id });
    await tx.insert(mpcDocuments).values(
      ready.map((d) => ({
        agencyId: member.agencyId,
        mpcId: row.id,
        kind: d.kind,
        blobUrl: d.blobUrl,
        filename: d.filename,
        text: d.text,
        createdBy: member.userId,
      })),
    );
    return row.id;
  });
  revalidatePath("/mpcs");
  revalidatePath(`/mpcs/${mpcId}`);
  return { ok: true, mpcId, documentErrors };
}
