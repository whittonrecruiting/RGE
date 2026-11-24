// Shared RFC 4180 reader. Pure; used by the do-not-contact and history importers.

export type CsvRecord = { line: number; fields: string[] };

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, embedded commas and newlines, CRLF, BOM. */
export function readRecords(text: string): CsvRecord[] {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let startLine = 1;
  let pending = false; // something has been read for the current record

  const endField = () => {
    fields.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push({ line: startLine, fields });
    fields = [];
    pending = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      pending = true;
    } else if (ch === ",") {
      pending = true;
      endField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      if (pending || field !== "" || fields.length > 0) endRecord();
      line++;
      startLine = line;
    } else {
      pending = true;
      field += ch;
    }
  }
  if (pending || field !== "" || fields.length > 0) endRecord();
  return records;
}

export function parseCsv(text: string): string[][] {
  return readRecords(text).map((r) => r.fields);
}
