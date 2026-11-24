"use server";

import { revalidatePath } from "next/cache";
import { withAgency } from "@/db/with-agency";
import { requireMember } from "@/lib/auth";
import { normalizeEmail } from "@/lib/ledger/normalize";
import { addSuppression } from "@/lib/ledger/record";
import { can } from "@/lib/permissions";

// This file exports exactly one action. Opt-outs are permanent: there is deliberately no remove.

const MAX_NOTE = 500;

/** Adds an address to the permanent opt-out list. Any member may; it cannot be undone in RGE. */
export async function addOptOut(
  email: string,
  note: string,
): Promise<{ ok: true; result: "added" | "already" } | { ok: false; error: string }> {
  const member = await requireMember();
  if (!can(member, "suppression.add")) return { ok: false, error: "You do not have permission to add opt-outs." };
  const normalized = typeof email === "string" ? normalizeEmail(email) : null;
  if (!normalized) return { ok: false, error: "Enter one valid email address." };
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > MAX_NOTE) return { ok: false, error: `Keep the note under ${MAX_NOTE} characters.` };

  const result = await withAgency(member.agencyId, (tx) =>
    addSuppression(tx, member.agencyId, {
      email: normalized,
      reason: "manual",
      source: "manual",
      note: text || null,
      createdBy: member.userId,
    }),
  );
  revalidatePath("/campaign");
  return { ok: true, result };
}
