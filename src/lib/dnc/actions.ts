"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { doNotContact } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cleanDncInput, parseDncCsv, type CsvLineError, type DncInput } from "./csv";
import { upsertDncEntries } from "./queries";

type Ok = { ok: true };
type Fail = { ok: false; error: string };

const NO_PERMISSION = "You do not have permission to change the do-not-contact list.";
const MAX_BYTES = 1024 * 1024;
const fail = (error: string): Fail => ({ ok: false, error });

/** Adds one company. An existing company with the same name gets the new domains and aliases merged in. */
export async function addDncEntry(input: DncInput): Promise<Ok | Fail> {
  const member = await requireMember();
  if (!can(member, "dnc.edit")) return fail(NO_PERMISSION);
  if (typeof input !== "object" || input === null || !Array.isArray(input.domains) || !Array.isArray(input.aliases)) {
    return fail("Nothing to save.");
  }
  const cleaned = cleanDncInput({
    name: typeof input.name === "string" ? input.name : "",
    domains: input.domains.filter((d): d is string => typeof d === "string"),
    aliases: input.aliases.filter((a): a is string => typeof a === "string"),
    note: typeof input.note === "string" ? input.note : null,
  });
  if (!cleaned.ok) return fail(cleaned.reason);

  await withAgency(member.agencyId, (tx) =>
    upsertDncEntries(tx, member.agencyId, [cleaned.row], "manual", member.userId),
  );
  revalidatePath("/settings");
  return { ok: true };
}

/** Removes a company from the list; it can be contacted again once no entry matches it. */
export async function removeDncEntry(id: string): Promise<Ok | Fail> {
  const member = await requireMember();
  if (!can(member, "dnc.edit")) return fail(NO_PERMISSION);
  if (typeof id !== "string" || !id) return fail("That entry was not found.");
  let removed = 0;
  try {
    const rows = await withAgency(member.agencyId, (tx) =>
      tx.delete(doNotContact).where(eq(doNotContact.id, id)).returning({ id: doNotContact.id }),
    );
    removed = rows.length;
  } catch {
    // A malformed id fails the uuid cast; it is simply not found.
    removed = 0;
  }
  if (removed === 0) return fail("That entry was not found.");
  revalidatePath("/settings");
  return { ok: true };
}

/** Imports a CSV (headers name, domains, aliases, note). Reads the upload from form field "file". */
export async function importDncCsv(
  form: FormData,
): Promise<{ ok: true; added: number; merged: number; errors: CsvLineError[] } | Fail> {
  const member = await requireMember();
  if (!can(member, "dnc.edit")) return fail(NO_PERMISSION);

  const file = form instanceof FormData ? form.get("file") : null;
  if (typeof file === "string" || file === null || typeof (file as File).text !== "function") {
    return fail("Choose a .csv file to upload.");
  }
  const upload = file as File;
  if (upload.size === 0) return fail("That file is empty.");
  if (upload.size >= MAX_BYTES) return fail("That file is too large. Keep it under 1 MB.");
  if (!/\.csv$/i.test(upload.name) && upload.type !== "text/csv") return fail("Upload a .csv file.");

  const { rows, errors } = parseDncCsv(await upload.text());
  if (rows.length === 0) return { ok: true, added: 0, merged: 0, errors };

  const { added, merged } = await withAgency(member.agencyId, (tx) =>
    upsertDncEntries(tx, member.agencyId, rows, "csv", member.userId),
  );
  revalidatePath("/settings");
  return { ok: true, added, merged, errors };
}
