import { readRecords } from "@/lib/csv";
import { normalizeDomain } from "@/lib/ledger/normalize";

// Not a "use server" file: pure helpers shared by the actions and the tests.

export type DncInput = { name: string; domains: string[]; aliases: string[]; note?: string | null };
export type CsvLineError = { line: number; reason: string };

export const MAX_NAME = 200;
export const MAX_NOTE = 500;

const splitList = (raw: string) =>
  raw
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);

export type CleanResult = { ok: true; row: DncInput } | { ok: false; reason: string };

/** Trims, normalizes and validates one entry. Used by the form action and the CSV reader. */
export function cleanDncInput(input: {
  name: string;
  domains: string[];
  aliases: string[];
  note?: string | null;
}): CleanResult {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, reason: "Enter the company name." };
  if (name.length > MAX_NAME) return { ok: false, reason: `The company name is over ${MAX_NAME} characters.` };

  const domains: string[] = [];
  for (const raw of input.domains) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const domain = normalizeDomain(trimmed);
    if (!domain) return { ok: false, reason: `"${trimmed.slice(0, 80)}" is not a domain.` };
    if (!domains.includes(domain)) domains.push(domain);
  }

  const aliases: string[] = [];
  for (const raw of input.aliases) {
    const alias = raw.trim();
    if (!alias) continue;
    if (alias.length > MAX_NAME) return { ok: false, reason: `An alias is over ${MAX_NAME} characters.` };
    if (!aliases.some((a) => a.toLowerCase() === alias.toLowerCase())) aliases.push(alias);
  }

  if (domains.length === 0 && aliases.length === 0) return { ok: false, reason: "Add at least one domain or alias." };

  const note = (input.note ?? "").trim();
  if (note.length > MAX_NOTE) return { ok: false, reason: `The note is over ${MAX_NOTE} characters.` };
  return { ok: true, row: { name, domains, aliases, note: note || null } };
}

/** Reads a do-not-contact CSV: headers name, domains, aliases, note (any case); lists split on ; or |. */
export function parseDncCsv(text: string): { rows: DncInput[]; errors: CsvLineError[] } {
  const records = readRecords(text);
  const header = records[0];
  const rows: DncInput[] = [];
  const errors: CsvLineError[] = [];
  if (!header) return { rows, errors: [{ line: 1, reason: "The file is empty." }] };

  const index = (name: string) => header.fields.findIndex((h) => h.trim().toLowerCase() === name);
  const nameAt = index("name");
  const domainsAt = index("domains");
  const aliasesAt = index("aliases");
  const noteAt = index("note");
  if (nameAt === -1 || (domainsAt === -1 && aliasesAt === -1)) {
    return {
      rows,
      errors: [{ line: header.line, reason: "The first row must have the column names name, domains and aliases." }],
    };
  }

  for (const record of records.slice(1)) {
    const cell = (at: number) => (at === -1 ? "" : (record.fields[at] ?? ""));
    if (record.fields.every((c) => c.trim() === "")) continue;
    const cleaned = cleanDncInput({
      name: cell(nameAt),
      domains: splitList(cell(domainsAt)),
      aliases: splitList(cell(aliasesAt)),
      note: cell(noteAt),
    });
    if (cleaned.ok) rows.push(cleaned.row);
    else errors.push({ line: record.line, reason: cleaned.reason });
  }
  return { rows, errors };
}
