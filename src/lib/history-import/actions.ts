"use server";

import { revalidatePath } from "next/cache";
import { withAgency } from "@/db/with-agency";
import { requireMember, type Member } from "@/lib/auth";
import { upsertDncEntries } from "@/lib/dnc/queries";
import { addSuppression, ownDomains, recordEvents } from "@/lib/ledger/record";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings/get";
import { IMPORT_KINDS, parseImport, type ImportKind, type SkippedRow } from "./parsers";

export type ImportSummary = {
  rows: number;
  newEvents: number;
  newSuppressions: number;
  dncAdded: number;
  dncMerged: number;
  skipped: SkippedRow[];
};

type Result = { ok: true; summary: ImportSummary } | { ok: false; error: string };

const NO_PERMISSION = "You do not have permission to import history.";
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20_000;
const fail = (error: string): Result => ({ ok: false, error });

/** Thrown after a preview has computed its counts so the transaction rolls back. Private to this file. */
class PreviewRollback extends Error {
  constructor(readonly summary: ImportSummary) {
    super("preview rollback");
  }
}

async function run(form: FormData, dryRun: boolean): Promise<Result> {
  const member: Member = await requireMember();
  if (!can(member, "history.import")) return fail(NO_PERMISSION);

  const kindField = form instanceof FormData ? form.get("kind") : null;
  const kind = IMPORT_KINDS.find((k) => k === kindField) as ImportKind | undefined;
  if (!kind) return fail("Choose what kind of file this is.");

  const file = form.get("file");
  if (typeof file === "string" || file === null || typeof (file as File).text !== "function") {
    return fail("Choose a file to import.");
  }
  const upload = file as File;
  if (upload.size === 0) return fail("That file is empty.");
  if (upload.size >= MAX_BYTES) return fail("That file is too large. Keep it under 5 MB.");
  const allowed = kind === "suppression" ? /\.(csv|txt)$/i : /\.csv$/i;
  if (!allowed.test(upload.name)) {
    return fail(kind === "suppression" ? "Upload a .csv or .txt file." : "Upload a .csv file.");
  }

  const { timeZone } = await getSettings(member.agencyId);
  const parsed = parseImport(kind, upload.name, await upload.text(), timeZone);
  if (parsed.rows > MAX_ROWS) return fail("This file is too large. Split it into smaller files.");
  if (parsed.rows === 0) return fail(parsed.skipped[0]?.reason ?? "That file has no rows.");

  const inputs = parsed.inputs.map((i) => ({ ...i, source: "import" as const, userId: member.userId }));
  try {
    const summary = await withAgency(member.agencyId, async (tx) => {
      const own = inputs.length > 0 ? await ownDomains(tx) : [];
      const { inserted } = inputs.length > 0 ? await recordEvents(tx, member.agencyId, inputs, { ownDomains: own }) : { inserted: 0 };
      let newSuppressions = 0;
      for (const s of parsed.suppressions) {
        const outcome = await addSuppression(tx, member.agencyId, {
          email: s.email,
          reason: s.reason,
          source: "import",
          createdBy: member.userId,
        });
        if (outcome === "added") newSuppressions++;
      }
      const dnc =
        parsed.dnc.length > 0
          ? await upsertDncEntries(tx, member.agencyId, parsed.dnc, "csv", member.userId)
          : { added: 0, merged: 0 };
      const result: ImportSummary = {
        rows: parsed.rows,
        newEvents: inserted,
        newSuppressions,
        dncAdded: dnc.added,
        dncMerged: dnc.merged,
        skipped: parsed.skipped,
      };
      if (dryRun) throw new PreviewRollback(result);
      return result;
    });
    revalidatePath("/settings");
    return { ok: true, summary };
  } catch (error) {
    if (error instanceof PreviewRollback) return { ok: true, summary: error.summary };
    // Log the error type only: database messages can echo row values (addresses).
    console.error("history import failed", error instanceof Error ? error.name : "unknown");
    return fail("The import could not be completed. Nothing was saved.");
  }
}

/** Counts what an import would add, writing nothing. Reads the upload from form fields "kind" and "file". */
export async function previewImport(form: FormData): Promise<Result> {
  return run(form, true);
}

/** Imports the file. Importing the same file again adds nothing new. */
export async function applyImport(form: FormData): Promise<Result> {
  return run(form, false);
}
