"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { mpcConsents, mpcs } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { MAX_FILE_BYTES } from "@/lib/docs/text";
import { putFile } from "@/lib/storage";
import { isUuid } from "./queries";

export type ConsentInput = {
  /** YYYY-MM-DD. */
  givenOn: string;
  method: "verbal" | "email" | "signed_form";
  proofFile?: File | null;
};
export type ConsentResult = { ok: true } | { ok: false; error: string };

const METHODS = ["verbal", "email", "signed_form"] as const;
const PROOF_EXT = /\.(pdf|png|jpe?g|gif|webp|heic|txt|md)$/i;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Today's date in Phoenix, where the agency works, as YYYY-MM-DD. */
function todayPhoenix(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function validDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function proofAllowed(file: File): boolean {
  const t = file.type.toLowerCase();
  return t === "application/pdf" || t.startsWith("image/") || t.startsWith("text/") || (t === "" && PROOF_EXT.test(file.name));
}

/** Adds a consent record. Earlier records are kept as history. */
export async function recordConsent(mpcId: string, input: ConsentInput): Promise<ConsentResult> {
  const member = await requireMember();
  if (!isUuid(mpcId)) return fail("MPC not found.");
  const [row] = await withAgency(member.agencyId, (tx) =>
    tx.select({ ownerUserId: mpcs.ownerUserId }).from(mpcs).where(eq(mpcs.id, mpcId)),
  );
  if (!row) return fail("MPC not found.");
  if (!can(member, "mpc.edit", { ownerUserId: row.ownerUserId })) return fail("You can only edit your own MPCs.");

  if (!validDate(input?.givenOn)) return fail("Enter the date consent was given.");
  if (input.givenOn > todayPhoenix()) return fail("Consent date cannot be in the future.");
  if (!METHODS.includes(input?.method)) return fail("Choose how consent was given.");

  let proofBlobUrl: string | null = null;
  const file = input.proofFile;
  if (file && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return fail("Proof file is larger than 10 MB.");
    if (!proofAllowed(file)) return fail("Proof must be a PDF, an image or a text file.");
    try {
      proofBlobUrl = (await putFile(file.name, new Uint8Array(await file.arrayBuffer()), file.type || "application/octet-stream")).url;
    } catch (err) {
      return fail(err instanceof Error ? err.message : "The file could not be saved. Try again.");
    }
  }

  await withAgency(member.agencyId, (tx) =>
    tx.insert(mpcConsents).values({
      agencyId: member.agencyId,
      mpcId,
      givenOn: input.givenOn,
      method: input.method,
      proofBlobUrl,
      recordedBy: member.userId,
    }),
  );
  revalidatePath("/mpcs");
  revalidatePath(`/mpcs/${mpcId}`);
  return { ok: true };
}
