export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type TextResult = { ok: true; text: string } | { ok: false; error: string };
export type TextInput = { name: string; type: string; bytes: Uint8Array };

const TOO_BIG = "File is larger than 10 MB.";
const UNSUPPORTED = "This file type is not supported. Use PDF, Word or text.";
const NO_TEXT = "No text found. If this is a scanned PDF, paste the text instead.";
const EMPTY = "The file is empty.";
const UNREADABLE = "This file could not be read. Try another file or paste the text instead.";

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
};

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocumentProxy, extractText: extract } = await import("unpdf");
  // pdf.js takes ownership of the buffer, so hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extract(pdf, { mergePages: true });
  return text;
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return value;
}

/** Plain text from a PDF, Word (.docx), .txt or .md file of at most 10 MB. */
export async function extractText(file: TextInput): Promise<TextResult> {
  if (file.bytes.length > MAX_FILE_BYTES) return { ok: false, error: TOO_BIG };
  const ext = extensionOf(file.name);
  if (!["pdf", "docx", "txt", "md"].includes(ext)) return { ok: false, error: UNSUPPORTED };
  if (file.bytes.length === 0) return { ok: false, error: EMPTY };

  if (ext === "txt" || ext === "md") {
    const text = new TextDecoder("utf-8").decode(file.bytes);
    return text.trim() === "" ? { ok: false, error: EMPTY } : { ok: true, text };
  }

  let text: string;
  try {
    text = ext === "pdf" ? await pdfText(file.bytes) : await docxText(file.bytes);
  } catch {
    return { ok: false, error: UNREADABLE };
  }
  const clean = text.replace(/\r\n?/g, "\n").trim();
  return clean === "" ? { ok: false, error: NO_TEXT } : { ok: true, text: clean };
}
