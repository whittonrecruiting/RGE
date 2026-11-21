"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { mpcCredentials, mpcFacts, mpcRestrictions, mpcs } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { requireMember, type Member } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cleanFactText } from "./fact-text";
import { isUuid } from "./queries";

export type FactActionResult = { ok: true } | { ok: false; error: string };
export type RestrictionInput = { kind: "never_say" | "confidential" | "excluded_company" | "region_exclusion"; value: string };
export type CredentialInput = { kind: string; region: string; verified: boolean };

const NOT_FOUND = "MPC not found.";
const FACT_NOT_FOUND = "Fact not found.";
const NOT_YOURS = "You can only edit your own MPCs.";
const KINDS = ["never_say", "confidential", "excluded_company", "region_exclusion"] as const;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Looks up the MPC owner and checks the member may edit it. */
async function authorizeMpc(member: Member, mpcId: string): Promise<FactActionResult> {
  if (!isUuid(mpcId)) return fail(NOT_FOUND);
  const [row] = await withAgency(member.agencyId, (tx) =>
    tx.select({ ownerUserId: mpcs.ownerUserId }).from(mpcs).where(eq(mpcs.id, mpcId)),
  );
  if (!row) return fail(NOT_FOUND);
  return can(member, "mpc.edit", { ownerUserId: row.ownerUserId }) ? { ok: true } : fail(NOT_YOURS);
}

type FactAuth =
  | {
      ok: true;
      mpcId: string;
      status: "usable" | "interview_only" | "confirmed";
      sourceKind: "resume" | "notes" | "transcript" | "web" | "manual";
    }
  | { ok: false; error: string };

/** Finds a fact and checks the member may edit its MPC. */
async function authorizeFact(member: Member, factId: string): Promise<FactAuth> {
  if (!isUuid(factId)) return fail(FACT_NOT_FOUND);
  const [row] = await withAgency(member.agencyId, (tx) =>
    tx
      .select({ mpcId: mpcFacts.mpcId, status: mpcFacts.status, sourceKind: mpcFacts.sourceKind, ownerUserId: mpcs.ownerUserId })
      .from(mpcFacts)
      .innerJoin(mpcs, eq(mpcs.id, mpcFacts.mpcId))
      .where(eq(mpcFacts.id, factId)),
  );
  if (!row) return fail(FACT_NOT_FOUND);
  if (!can(member, "mpc.edit", { ownerUserId: row.ownerUserId })) return fail(NOT_YOURS);
  return { ok: true, mpcId: row.mpcId, status: row.status, sourceKind: row.sourceKind };
}

function refresh(mpcId: string) {
  revalidatePath("/mpcs");
  revalidatePath(`/mpcs/${mpcId}`);
}

/** Marks an interview-only fact as confirmed by the caller. Any other status is left alone. */
export async function confirmFact(factId: string): Promise<FactActionResult> {
  const member = await requireMember();
  const auth = await authorizeFact(member, factId);
  if (!auth.ok) return auth;
  if (auth.status === "interview_only") {
    await withAgency(member.agencyId, (tx) =>
      tx
        .update(mpcFacts)
        .set({ status: "confirmed", confirmedBy: member.userId, confirmedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(mpcFacts.id, factId), eq(mpcFacts.status, "interview_only"))),
    );
  }
  refresh(auth.mpcId);
  return { ok: true };
}

/**
 * Changes the wording and records who edited it. A usable or confirmed fact from a resume, notes,
 * a transcript or the web no longer matches its quote once reworded, so it becomes a manual fact
 * confirmed by the editor (source and quote cleared). A manual fact stays manual and confirmed. An
 * interview-only fact keeps its status and source: it still needs a confirm before any pitch.
 */
export async function updateFact(factId: string, text: string): Promise<FactActionResult> {
  const member = await requireMember();
  const auth = await authorizeFact(member, factId);
  if (!auth.ok) return auth;
  const clean = cleanFactText(text);
  if (!clean.ok) return clean;
  const now = new Date();
  const edit = { text: clean.text, editedBy: member.userId, editedAt: now, updatedAt: now };
  const converts = auth.status !== "interview_only" && auth.sourceKind !== "manual";
  await withAgency(member.agencyId, (tx) =>
    tx
      .update(mpcFacts)
      .set(
        converts
          ? {
              ...edit,
              sourceKind: "manual",
              status: "confirmed",
              sourceQuote: null,
              sourceRef: null,
              sourceDocumentId: null,
              confirmedBy: member.userId,
              confirmedAt: now,
            }
          : edit,
      )
      .where(eq(mpcFacts.id, factId)),
  );
  refresh(auth.mpcId);
  return { ok: true };
}

export async function deleteFact(factId: string): Promise<FactActionResult> {
  const member = await requireMember();
  const auth = await authorizeFact(member, factId);
  if (!auth.ok) return auth;
  await withAgency(member.agencyId, (tx) => tx.delete(mpcFacts).where(eq(mpcFacts.id, factId)));
  refresh(auth.mpcId);
  return { ok: true };
}

/** A fact the recruiter typed in. It is confirmed by them, so it can be used in pitches. */
export async function addManualFact(mpcId: string, text: string): Promise<FactActionResult> {
  const member = await requireMember();
  const auth = await authorizeMpc(member, mpcId);
  if (!auth.ok) return auth;
  const clean = cleanFactText(text);
  if (!clean.ok) return clean;
  await withAgency(member.agencyId, (tx) =>
    tx.insert(mpcFacts).values({
      agencyId: member.agencyId,
      mpcId,
      text: clean.text,
      sourceKind: "manual",
      status: "confirmed",
      confirmedBy: member.userId,
      confirmedAt: new Date(),
    }),
  );
  refresh(mpcId);
  return { ok: true };
}

/** Replaces the full restriction list for the MPC. Nothing is written if any item is invalid. */
export async function setRestrictions(mpcId: string, items: RestrictionInput[]): Promise<FactActionResult> {
  const member = await requireMember();
  const auth = await authorizeMpc(member, mpcId);
  if (!auth.ok) return auth;
  if (!Array.isArray(items)) return fail("Check the restrictions and try again.");
  const clean: RestrictionInput[] = [];
  for (const it of items) {
    const value = typeof it?.value === "string" ? it.value.trim() : "";
    if (!KINDS.includes(it?.kind)) return fail("Choose a type for every restriction.");
    if (value === "") return fail("Enter a value for every restriction, or remove the empty row.");
    if (value.length > 200) return fail("Keep each restriction to 200 characters or fewer.");
    clean.push({ kind: it.kind, value });
  }
  await withAgency(member.agencyId, async (tx) => {
    await tx.delete(mpcRestrictions).where(eq(mpcRestrictions.mpcId, mpcId));
    if (clean.length > 0) {
      await tx.insert(mpcRestrictions).values(clean.map((r) => ({ agencyId: member.agencyId, mpcId, kind: r.kind, value: r.value })));
    }
  });
  refresh(mpcId);
  return { ok: true };
}

/** Replaces the full credential list for the MPC. Nothing is written if any item is invalid. */
export async function setCredentials(mpcId: string, items: CredentialInput[]): Promise<FactActionResult> {
  const member = await requireMember();
  const auth = await authorizeMpc(member, mpcId);
  if (!auth.ok) return auth;
  if (!Array.isArray(items)) return fail("Check the credentials and try again.");
  const clean: CredentialInput[] = [];
  for (const it of items) {
    const kind = typeof it?.kind === "string" ? it.kind.trim() : "";
    const region = typeof it?.region === "string" ? it.region.trim() : "";
    if (kind === "" || region === "") return fail("Enter a credential and a region for every row, or remove the empty row.");
    if (kind.length > 80 || region.length > 80) return fail("Keep each credential and region to 80 characters or fewer.");
    clean.push({ kind, region, verified: it.verified === true });
  }
  await withAgency(member.agencyId, async (tx) => {
    await tx.delete(mpcCredentials).where(eq(mpcCredentials.mpcId, mpcId));
    if (clean.length > 0) {
      await tx
        .insert(mpcCredentials)
        .values(clean.map((c) => ({ agencyId: member.agencyId, mpcId, kind: c.kind, region: c.region, verified: c.verified })));
    }
  });
  refresh(mpcId);
  return { ok: true };
}
