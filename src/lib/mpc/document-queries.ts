import { asc, eq } from "drizzle-orm";
import { mpcDocuments, mpcFacts } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import type { Member } from "@/lib/auth";
import type { Source } from "@/lib/ai/extract-profile";
import { isUuid } from "./queries";

export type DocumentRow = {
  id: string;
  kind: "resume" | "notes" | "transcript";
  filename: string;
  hasFile: boolean;
  text: string | null;
  createdAt: Date;
};

/** Documents of one MPC, oldest first. Row-level security scopes the agency. */
export async function listDocuments(member: Member, mpcId: string): Promise<DocumentRow[]> {
  if (!isUuid(mpcId)) return [];
  const rows = await withAgency(member.agencyId, (tx) =>
    tx
      .select({
        id: mpcDocuments.id,
        kind: mpcDocuments.kind,
        filename: mpcDocuments.filename,
        blobUrl: mpcDocuments.blobUrl,
        text: mpcDocuments.text,
        createdAt: mpcDocuments.createdAt,
      })
      .from(mpcDocuments)
      .where(eq(mpcDocuments.mpcId, mpcId))
      .orderBy(asc(mpcDocuments.createdAt), asc(mpcDocuments.id)),
  );
  return rows.map(({ blobUrl, ...r }) => ({ ...r, hasFile: blobUrl !== null }));
}

/**
 * Turns stored documents into extraction sources. The ref is the filename; a repeated filename
 * gets a counter so every ref points at exactly one document.
 */
export function toSources(docs: Pick<DocumentRow, "kind" | "filename" | "text">[]): Source[] {
  const used = new Map<string, number>();
  const sources: Source[] = [];
  for (const d of docs) {
    if (!d.text || d.text.trim() === "") continue;
    const n = (used.get(d.filename) ?? 0) + 1;
    used.set(d.filename, n);
    sources.push({ kind: d.kind, text: d.text, ref: n === 1 ? d.filename : `${d.filename} (${n})` });
  }
  return sources;
}

export type FactRow = {
  id: string;
  text: string;
  sourceKind: "resume" | "notes" | "transcript" | "web" | "manual";
  sourceRef: string | null;
  sourceQuote: string | null;
  status: "usable" | "interview_only" | "confirmed";
  /** Set when the wording was changed by hand. */
  editedAt: Date | null;
  createdAt: Date;
};

/** Facts of one MPC, oldest first. */
export async function listFacts(member: Member, mpcId: string): Promise<FactRow[]> {
  if (!isUuid(mpcId)) return [];
  return withAgency(member.agencyId, (tx) =>
    tx
      .select({
        id: mpcFacts.id,
        text: mpcFacts.text,
        sourceKind: mpcFacts.sourceKind,
        sourceRef: mpcFacts.sourceRef,
        sourceQuote: mpcFacts.sourceQuote,
        status: mpcFacts.status,
        editedAt: mpcFacts.editedAt,
        createdAt: mpcFacts.createdAt,
      })
      .from(mpcFacts)
      .where(eq(mpcFacts.mpcId, mpcId))
      .orderBy(asc(mpcFacts.createdAt), asc(mpcFacts.id)),
  );
}
