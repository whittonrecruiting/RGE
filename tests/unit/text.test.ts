import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { extractText } from "@/lib/docs/text";

const fixture = (name: string, type: string) => ({
  name,
  type,
  bytes: new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures", name))),
});
const enc = (s: string) => new TextEncoder().encode(s);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("extractText", () => {
  test("rejects files over 10 MB", async () => {
    expect(
      await extractText({ name: "a.pdf", type: "application/pdf", bytes: new Uint8Array(10 * 1024 * 1024 + 1) }),
    ).toEqual({ ok: false, error: "File is larger than 10 MB." });
  });

  test("scanned PDF with no text gives the paste message", async () => {
    expect(await extractText(fixture("scanned-no-text.pdf", "application/pdf"))).toEqual({
      ok: false,
      error: "No text found. If this is a scanned PDF, paste the text instead.",
    });
  });

  test("reads text from the docx fixture", async () => {
    const r = await extractText(fixture("resume-fake.docx", DOCX));
    expect(r.ok && r.text).toContain("Led discovery on a $120M breach of contract matter");
  });

  test("reads text from the text-layer pdf fixture", async () => {
    const r = await extractText(fixture("resume-fake.pdf", "application/pdf"));
    expect(r.ok && r.text).toContain("Led discovery on a $120M breach of contract matter");
  });

  test("reads txt and md files", async () => {
    expect(await extractText({ name: "n.txt", type: "text/plain", bytes: enc("Hello notes") })).toEqual({
      ok: true,
      text: "Hello notes",
    });
    expect(await extractText({ name: "n.MD", type: "", bytes: enc("# Notes") })).toEqual({ ok: true, text: "# Notes" });
  });

  test("rejects unsupported types and empty files", async () => {
    expect(await extractText({ name: "a.exe", type: "", bytes: enc("x") })).toEqual({
      ok: false,
      error: "This file type is not supported. Use PDF, Word or text.",
    });
    expect(await extractText({ name: "a.txt", type: "text/plain", bytes: new Uint8Array(0) })).toEqual({
      ok: false,
      error: "The file is empty.",
    });
  });

  test("whitespace-only text file has no text", async () => {
    const r = await extractText({ name: "a.txt", type: "text/plain", bytes: enc("   \n  ") });
    expect(r.ok).toBe(false);
  });

  test("a corrupt pdf fails with a readable message", async () => {
    const r = await extractText({ name: "a.pdf", type: "application/pdf", bytes: enc("not a pdf") });
    expect(r).toEqual({ ok: false, error: "This file could not be read. Try another file or paste the text instead." });
  });
});
