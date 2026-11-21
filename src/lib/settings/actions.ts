"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { agencies, agencySettings } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  APPROVAL_AUTO_WARNING,
  CALCULATED_KEYS,
  DEFAULT_SETTINGS,
  mergeOverDefaults,
  type Settings,
} from "@/lib/settings-defaults";
import { settingsSchema } from "./schema";

export type SettingsResult = { ok: true } | { ok: false; error: string };

type Editable = Omit<Settings, (typeof CALCULATED_KEYS)[number]>;
type PartialNested<T> = { [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? Partial<T[K]> : T[K] };

/** What a caller may change. Nested objects (stageChances, templates, sendWindow) merge per key. */
export type SettingsPatch = PartialNested<Editable> & {
  /** Must be true when this save switches approvals to auto. */
  approvalModeConfirmed?: boolean;
};

const NO_PERMISSION = "You do not have permission to change settings.";
const CALCULATED = "Pitch cap and warm-up are calculated by RGE and cannot be changed here.";

const fail = (error: string): SettingsResult => ({ ok: false, error });
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const EDITABLE_KEYS = new Set(Object.keys(DEFAULT_SETTINGS).filter((k) => !(CALCULATED_KEYS as readonly string[]).includes(k)));

/** Saves a partial update of the agency's settings. Owner and Admin only. */
export async function updateSettings(patch: SettingsPatch): Promise<SettingsResult> {
  // Every action calls requireMember() itself: the layout guard does not protect server actions.
  const member = await requireMember();
  if (!can(member, "settings.edit")) return fail(NO_PERMISSION);
  if (!isPlain(patch)) return fail("Nothing to save.");

  const { approvalModeConfirmed, ...changes } = patch as Record<string, unknown>;
  for (const key of Object.keys(changes)) {
    if ((CALCULATED_KEYS as readonly string[]).includes(key)) return fail(CALCULATED);
    if (!EDITABLE_KEYS.has(key)) return fail(`Unknown setting "${key}".`);
  }

  const result = await withAgency(member.agencyId, async (tx): Promise<SettingsResult> => {
    // Lock the row (when it exists) so two saves do not overwrite each other's merge.
    const [row] = await tx
      .select({ values: agencySettings.values })
      .from(agencySettings)
      .where(eq(agencySettings.agencyId, member.agencyId))
      .for("update");
    const stored = isPlain(row?.values) ? row.values : {};
    const current = mergeOverDefaults(DEFAULT_SETTINGS, stored);

    const candidate: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) continue;
      const base = candidate[key];
      candidate[key] = isPlain(base) && isPlain(value) ? { ...base, ...stripUndefined(value) } : value;
    }

    const parsed = settingsSchema.safeParse(candidate);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Those settings are not valid.");
    const next = parsed.data;

    if (next.approvalMode === "auto" && current.approvalMode !== "auto" && approvalModeConfirmed !== true) {
      return fail(APPROVAL_AUTO_WARNING);
    }

    const toStore: Record<string, unknown> = { ...stored };
    for (const key of Object.keys(changes)) {
      if (changes[key] !== undefined) toStore[key] = (next as Record<string, unknown>)[key];
    }
    await tx
      .insert(agencySettings)
      .values({ agencyId: member.agencyId, values: toStore })
      .onConflictDoUpdate({ target: agencySettings.agencyId, set: { values: toStore, updatedAt: sql`now()` } });
    if (changes.timeZone !== undefined) {
      await tx.update(agencies).set({ timeZone: next.timeZone, updatedAt: sql`now()` }).where(eq(agencies.id, member.agencyId));
    }
    return { ok: true };
  });

  if (result.ok) revalidatePath("/settings");
  return result;
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
