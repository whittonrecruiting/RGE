import { createHash } from "node:crypto";
import type { SuppressionReason } from "@/db/schema";
import { readRecords } from "@/lib/csv";
import { parseDncCsv, type DncInput } from "@/lib/dnc/csv";
import type { LedgerInput } from "@/lib/ledger/record";
import { normalizeEmail } from "@/lib/ledger/normalize";
import { parseWallTime } from "./csv";

// Not a "use server" file: pure parsers shared by the actions and the tests.

export type ImportKind = "suppression" | "sends" | "followups" | "outcomes" | "dnc";
export const IMPORT_KINDS: readonly ImportKind[] = ["suppression", "sends", "followups", "outcomes", "dnc"];

export type SkippedRow = { line: number; reason: string };

export type ParsedImport = {
  kind: ImportKind;
  inputs: LedgerInput[];
  suppressions: { email: string; reason: SuppressionReason }[];
  dnc: DncInput[];
  skipped: SkippedRow[];
  rows: number;
};

const BAD_DATE = "Date or time not recognized";
const EMAIL_IN_TEXT = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[^\s<>,;:"'()[\]]+/g;

const empty = (kind: ImportKind): ParsedImport => ({ kind, inputs: [], suppressions: [], dnc: [], skipped: [], rows: 0 });

type Table = { records: { line: number; cells: Map<string, string> }[]; headers: Set<string> };

function readTable(text: string): Table | null {
  const records = readRecords(text);
  const header = records[0];
  if (!header) return null;
  const names = header.fields.map((h) => h.trim().toLowerCase());
  const body = records
    .slice(1)
    .filter((r) => r.fields.some((c) => c.trim() !== ""))
    .map((r) => {
      const cells = new Map<string, string>();
      names.forEach((n, i) => {
        if (n && !cells.has(n)) cells.set(n, (r.fields[i] ?? "").trim());
      });
      return { line: r.line, cells };
    });
  return { records: body, headers: new Set(names) };
}

function missingColumns(out: ParsedImport, table: Table | null, required: string[][]): table is Table {
  if (!table) {
    out.skipped.push({ line: 1, reason: "The file is empty." });
    return false;
  }
  const lacking = required.filter((alts) => !alts.some((a) => table.headers.has(a)));
  if (lacking.length > 0) {
    out.skipped.push({ line: 1, reason: `Missing column: ${lacking.map((a) => a.join(" or ")).join(", ")}.` });
    return false;
  }
  return true;
}

const pick = (cells: Map<string, string>, ...names: string[]) => {
  for (const n of names) {
    const v = cells.get(n);
    if (v !== undefined) return v;
  }
  return "";
};

function parseSuppression(filename: string, text: string): ParsedImport {
  const out = empty("suppression");
  if (/\.txt$/i.test(filename)) {
    const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
    lines.forEach((raw, i) => {
      if (!raw.trim()) return;
      out.rows++;
      const found: string[] = [];
      for (const match of raw.match(EMAIL_IN_TEXT) ?? []) {
        const email = normalizeEmail(match.replace(/[.]+$/, ""));
        if (email && !found.includes(email)) found.push(email);
      }
      if (found.length === 0) out.skipped.push({ line: i + 1, reason: "No email address found" });
      for (const email of found) out.suppressions.push({ email, reason: "opted_out" });
    });
    return out;
  }
  const table = readTable(text);
  if (!missingColumns(out, table, [["email", "recipient"]])) return out;
  for (const r of table.records) {
    out.rows++;
    const email = normalizeEmail(pick(r.cells, "email", "recipient"));
    if (!email) {
      out.skipped.push({ line: r.line, reason: "Not an email address" });
      continue;
    }
    const reason: SuppressionReason = /bounce/i.test(pick(r.cells, "reason")) ? "bounced" : "opted_out";
    out.suppressions.push({ email, reason });
  }
  return out;
}

/** status empty or "sent" is imported; anything else gives the skip reason. */
function statusSkip(status: string): string | null {
  const s = status.trim().toLowerCase();
  return s === "" || s === "sent" ? null : `status ${s} not imported`;
}

function parseSendLike(kind: "sends" | "followups", text: string, timeZone: string): ParsedImport {
  const out = empty(kind);
  const table = readTable(text);
  if (!missingColumns(out, table, [["recipient"], ["time"]])) return out;
  const idColumn = kind === "sends" ? "message_id" : "followup_message_id";
  for (const r of table.records) {
    out.rows++;
    const skip = statusSkip(pick(r.cells, "status"));
    if (skip) {
      out.skipped.push({ line: r.line, reason: skip });
      continue;
    }
    const email = normalizeEmail(pick(r.cells, "recipient"));
    if (!email) {
      out.skipped.push({ line: r.line, reason: "Recipient is not an email address" });
      continue;
    }
    const at = parseWallTime(pick(r.cells, "time"), timeZone);
    if (!at) {
      out.skipped.push({ line: r.line, reason: BAD_DATE });
      continue;
    }
    const id = pick(r.cells, idColumn);
    const prefix = kind === "sends" ? "import:sent:" : "import:fu:";
    out.inputs.push({
      type: kind === "sends" ? "sent" : "follow_up_sent",
      email,
      companyName: kind === "sends" ? pick(r.cells, "company") || null : null,
      occurredAt: at,
      source: "import",
      dedupeKey: `${prefix}${id || `${email}:${at.toISOString()}`}`,
    });
  }
  return out;
}

function parseOutcomes(text: string, timeZone: string): ParsedImport {
  const out = empty("outcomes");
  const table = readTable(text);
  if (!missingColumns(out, table, [["date"], ["firm"], ["contact"], ["type"]])) return out;
  for (const r of table.records) {
    out.rows++;
    const type = pick(r.cells, "type").toLowerCase();
    const signed = type.startsWith("signed_");
    const pitch = type === "mpc_pitch_sent";
    if (!signed && !pitch) {
      out.skipped.push({ line: r.line, reason: "type not imported" });
      continue;
    }
    const at = parseWallTime(pick(r.cells, "date"), timeZone);
    if (!at) {
      out.skipped.push({ line: r.line, reason: BAD_DATE });
      continue;
    }
    const firm = pick(r.cells, "firm");
    const contact = pick(r.cells, "contact");
    const email = normalizeEmail(contact);
    const key = createHash("sha256")
      .update([at.toISOString(), firm.toLowerCase(), contact.toLowerCase(), type].join("\u001f"))
      .digest("hex");
    if (signed) {
      if (!firm) {
        out.skipped.push({ line: r.line, reason: "Firm is missing" });
        continue;
      }
      out.inputs.push({
        type: "agreement_signed",
        email,
        companyName: firm,
        occurredAt: at,
        source: "import",
        dedupeKey: `import:outcome:${key}`,
      });
    } else {
      if (!email) {
        out.skipped.push({ line: r.line, reason: "contact is not an email address" });
        continue;
      }
      out.inputs.push({
        type: "sent",
        email,
        companyName: firm || null,
        occurredAt: at,
        source: "import",
        dedupeKey: `import:outcome:${key}`,
      });
    }
  }
  return out;
}

function parseDnc(text: string): ParsedImport {
  const out = empty("dnc");
  const { rows, errors } = parseDncCsv(text);
  out.dnc = rows;
  out.skipped = errors.map((e) => ({ line: e.line, reason: e.reason }));
  out.rows = rows.length + errors.length;
  return out;
}

/**
 * Reads one old outreach file into ledger inputs, suppressions or do-not-contact entries.
 * Header names match case-insensitively and extra columns are ignored. Times without an offset
 * are read in timeZone. Rows that cannot be used are listed in `skipped` with the line number.
 */
export function parseImport(kind: ImportKind, filename: string, text: string, timeZone: string): ParsedImport {
  switch (kind) {
    case "suppression":
      return parseSuppression(filename, text);
    case "sends":
    case "followups":
      return parseSendLike(kind, text, timeZone);
    case "outcomes":
      return parseOutcomes(text, timeZone);
    case "dnc":
      return parseDnc(text);
  }
}
