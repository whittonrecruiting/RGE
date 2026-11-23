"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { memberships, mpcs } from "@/db/schema";
import { isCheckViolation } from "@/db/errors";
import { withAgency } from "@/db/with-agency";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isUuid } from "./queries";
import {
  mpcDraftInput,
  mpcInput,
  type MpcDraftFields,
  type MpcDraftInput,
  type MpcFields,
  type MpcInput,
  type SettableStatus,
} from "./schema";

export type MpcResult = { ok: true } | { ok: false; error: string };
/** activated is set when the update completed a draft and it became active. */
export type UpdateResult = { ok: true; activated?: true } | { ok: false; error: string };
export type CreateResult = { ok: true; id: string } | { ok: false; error: string };
export type PauseAllResult = { ok: true; count: number } | { ok: false; error: string };

const NOT_FOUND = "MPC not found.";
const NOT_YOURS = "You can only edit your own MPCs.";
const NO_REASSIGN = "You do not have permission to reassign MPCs.";
const NO_AGENCY_PAUSE = "You do not have permission to pause the whole agency.";
const NOT_ACTIVE_MEMBER = "Choose an active member of your team.";
const PLACED = "A placed MPC cannot be changed here.";
const DRAFT_INCOMPLETE = "Add the headline role and location before activating.";
const DRAFT_NO_PAUSE = "A draft cannot be paused until it has a headline role and location.";
const CHANGED = "This MPC changed. Reload and try again.";
const MAX_REASON = 500;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function revalidate(id?: string) {
  revalidatePath("/mpcs");
  if (id) revalidatePath(`/mpcs/${id}`);
}

const cleanReason = (reason: unknown): string | null => {
  const t = typeof reason === "string" ? reason.trim().slice(0, MAX_REASON) : "";
  return t === "" ? null : t;
};

type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };
const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";

function parseInput(input: MpcInput): Parsed<MpcFields> {
  const parsed = mpcInput.safeParse(input);
  return parsed.success ? { ok: true, data: parsed.data } : fail(firstIssue(parsed.error));
}

function parseDraftInput(input: MpcDraftInput): Parsed<MpcDraftFields> {
  const parsed = mpcDraftInput.safeParse(input);
  return parsed.success ? { ok: true, data: parsed.data } : fail(firstIssue(parsed.error));
}

/** A draft is complete, and becomes active, once it has both a headline role and a location. */
const isComplete = (v: { headlineRole: string | null; location: string | null }) =>
  v.headlineRole !== null && v.location !== null;

// Every action calls requireMember() itself: the layout guard does not protect server actions.

export async function createMpc(input: MpcInput): Promise<CreateResult> {
  const member = await requireMember();
  // Every member may add MPCs; each one starts out owned by its creator.
  if (!can(member, "mpc.edit", { ownerUserId: member.userId })) return fail(NOT_YOURS);
  const parsed = parseInput(input);
  if (!parsed.ok) return fail(parsed.error);
  const [row] = await withAgency(member.agencyId, (tx) =>
    tx
      .insert(mpcs)
      .values({ ...parsed.data, agencyId: member.agencyId, ownerUserId: member.userId })
      .returning({ id: mpcs.id }),
  );
  revalidate(row.id);
  return { ok: true, id: row.id };
}

/** Starts an empty draft owned by the caller. It becomes active once its headline role and location are set. */
export async function createDraftMpc(): Promise<CreateResult> {
  const member = await requireMember();
  if (!can(member, "mpc.edit", { ownerUserId: member.userId })) return fail(NOT_YOURS);
  const [row] = await withAgency(member.agencyId, (tx) =>
    tx
      .insert(mpcs)
      .values({ agencyId: member.agencyId, ownerUserId: member.userId, status: "draft" })
      .returning({ id: mpcs.id }),
  );
  revalidate(row.id);
  return { ok: true, id: row.id };
}

/**
 * Saves the profile. A draft may leave headline role and location blank; any other MPC must have
 * both. A draft that ends up with both becomes active in the same transaction.
 */
export async function updateMpc(id: string, input: MpcInput | MpcDraftInput): Promise<UpdateResult> {
  const member = await requireMember();
  if (!isUuid(id)) return fail(NOT_FOUND);
  let result: UpdateResult;
  try {
    result = await withAgency(member.agencyId, async (tx): Promise<UpdateResult> => {
      // Locked so a concurrent status change cannot slip between this read and the write below.
      const [current] = await tx
        .select({ ownerUserId: mpcs.ownerUserId, status: mpcs.status })
        .from(mpcs)
        .where(eq(mpcs.id, id))
        .for("update");
      if (!current) return fail(NOT_FOUND);
      if (!can(member, "mpc.edit", { ownerUserId: current.ownerUserId })) return fail(NOT_YOURS);
      if (current.status !== "draft") {
        const parsed = parseInput(input as MpcInput);
        if (!parsed.ok) return fail(parsed.error);
        await tx.update(mpcs).set({ ...parsed.data, updatedAt: new Date() }).where(eq(mpcs.id, id));
        return { ok: true };
      }
      const parsed = parseDraftInput(input);
      if (!parsed.ok) return fail(parsed.error);
      const activate = isComplete(parsed.data);
      await tx
        .update(mpcs)
        .set({ ...parsed.data, ...(activate ? { status: "active" as const } : {}), updatedAt: new Date() })
        .where(eq(mpcs.id, id));
      return activate ? { ok: true, activated: true } : { ok: true };
    });
  } catch (err) {
    // The database refused a status without role and location: the row changed under us.
    if (isCheckViolation(err, "mpcs_required_unless_draft")) return fail(CHANGED);
    throw err;
  }
  if (result.ok) revalidate(id);
  return result;
}

export async function setMpcStatus(id: string, status: SettableStatus, reason?: string): Promise<MpcResult> {
  const member = await requireMember();
  if (!isUuid(id)) return fail(NOT_FOUND);
  if (status !== "active" && status !== "paused" && status !== "removed") {
    return fail("That status cannot be set here.");
  }
  const result = await withAgency(member.agencyId, async (tx): Promise<MpcResult> => {
    const [current] = await tx
      .select({
        ownerUserId: mpcs.ownerUserId,
        status: mpcs.status,
        headlineRole: mpcs.headlineRole,
        location: mpcs.location,
      })
      .from(mpcs)
      .where(eq(mpcs.id, id))
      .for("update");
    if (!current) return fail(NOT_FOUND);
    if (!can(member, "mpc.edit", { ownerUserId: current.ownerUserId })) return fail(NOT_YOURS);
    if (current.status === "placed") return fail(PLACED);
    // Only a draft (or a discarded one, status removed) may lack these. Discarding a draft is allowed;
    // the database refuses active or paused without them.
    if (!isComplete(current) && status !== "removed") return fail(status === "active" ? DRAFT_INCOMPLETE : DRAFT_NO_PAUSE);
    await tx
      .update(mpcs)
      .set({ status, pauseReason: status === "paused" ? cleanReason(reason) : null, updatedAt: new Date() })
      .where(eq(mpcs.id, id));
    return { ok: true };
  });
  if (result.ok) revalidate(id);
  return result;
}

/**
 * Pauses active MPCs (never drafts): the caller's own by default. Owner and Admin may pass scope 'agency' to
 * pause every active MPC in the agency.
 */
export async function pauseAllMpcs(reason: string, scope: "mine" | "agency" = "mine"): Promise<PauseAllResult> {
  const member = await requireMember();
  if (scope !== "mine" && scope !== "agency") return fail("Choose mine or agency.");
  if (scope === "agency" && !can(member, "team.manage")) return fail(NO_AGENCY_PAUSE);
  const paused = await withAgency(member.agencyId, (tx) =>
    tx
      .update(mpcs)
      .set({ status: "paused", pauseReason: cleanReason(reason), updatedAt: new Date() })
      .where(
        and(
          eq(mpcs.agencyId, member.agencyId),
          eq(mpcs.status, "active"),
          scope === "mine" ? eq(mpcs.ownerUserId, member.userId) : undefined,
        ),
      )
      .returning({ id: mpcs.id }),
  );
  revalidate();
  for (const row of paused) revalidatePath(`/mpcs/${row.id}`);
  return { ok: true, count: paused.length };
}

/** Owner and Admin only: hand an MPC to another active member. */
export async function reassignMpc(id: string, newOwnerUserId: string): Promise<MpcResult> {
  const member = await requireMember();
  // Recruiters never reassign. There is no mpc.reassign action; the manager check is team.manage.
  if (!can(member, "team.manage")) return fail(NO_REASSIGN);
  if (!isUuid(id)) return fail(NOT_FOUND);
  if (!isUuid(newOwnerUserId)) return fail(NOT_ACTIVE_MEMBER);
  const result = await withAgency(member.agencyId, async (tx): Promise<MpcResult> => {
    const [current] = await tx.select({ id: mpcs.id }).from(mpcs).where(eq(mpcs.id, id));
    if (!current) return fail(NOT_FOUND);
    const [target] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.userId, newOwnerUserId), eq(memberships.status, "active")));
    if (!target) return fail(NOT_ACTIVE_MEMBER);
    await tx.update(mpcs).set({ ownerUserId: target.userId, updatedAt: new Date() }).where(eq(mpcs.id, id));
    return { ok: true };
  });
  if (result.ok) revalidate(id);
  return result;
}
