import { extractText, MAX_FILE_BYTES } from "@/lib/docs/text";
import { putFile } from "@/lib/storage";

// Shared by addDocument and buildProfile: the rules for one resume, notes or transcript.

export type DocKind = "resume" | "notes" | "transcript";
export const DOC_KINDS: readonly DocKind[] = ["resume", "notes", "transcript"];

export const BAD_KIND = "Choose resume, notes or transcript.";
export const NO_INPUT = "Paste some text or choose a file.";
const TOO_BIG = "File is larger than 10 MB.";
const TOO_LONG = "That text is too long. Paste up to 200,000 characters.";
const NOT_SAVED = "The file could not be saved. Try again.";
export const MAX_PASTED = 200_000;
const MAX_FILENAME = 200;

export const isDocKind = (v: unknown): v is DocKind => typeof v === "string" && DOC_KINDS.includes(v as DocKind);

/** A source whose text has been read and checked, not yet stored. */
export type PreparedSource = {
  kind: DocKind;
  filename: string;
  text: string;
  /** The original upload, kept in file storage. Pasted text has none. */
  upload: { name: string; type: string; bytes: Uint8Array } | null;
};

type Prepared = { ok: true; source: PreparedSource } | { ok: false; error: string };

/** Reads a file's text by the extractText rules (type, size, readable text). Stores nothing. */
export async function prepareFile(kind: unknown, file: File): Promise<Prepared> {
  if (!isDocKind(kind)) return { ok: false, error: BAD_KIND };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: TOO_BIG };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await extractText({ name: file.name, type: file.type, bytes });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    source: {
      kind,
      filename: file.name.slice(0, MAX_FILENAME),
      text: result.text,
      upload: { name: file.name, type: file.type || "application/octet-stream", bytes },
    },
  };
}

/** Checks pasted text. Blank text is NO_INPUT. Stores nothing. */
export function preparePaste(kind: unknown, pasted: string, name?: unknown): Prepared {
  if (!isDocKind(kind)) return { ok: false, error: BAD_KIND };
  if (pasted.trim() === "") return { ok: false, error: NO_INPUT };
  if (pasted.length > MAX_PASTED) return { ok: false, error: TOO_LONG };
  const filename = (typeof name === "string" && name.trim() !== "" ? name.trim() : `Pasted ${kind}`).slice(0, MAX_FILENAME);
  return { ok: true, source: { kind, filename, text: pasted, upload: null } };
}

/** Puts the original upload in file storage. Returns its URL, null for pasted text, or an error. */
export async function storeUpload(source: PreparedSource): Promise<{ ok: true; blobUrl: string | null } | { ok: false; error: string }> {
  if (!source.upload) return { ok: true, blobUrl: null };
  try {
    const { url } = await putFile(source.upload.name, source.upload.bytes, source.upload.type);
    return { ok: true, blobUrl: url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : NOT_SAVED };
  }
}
