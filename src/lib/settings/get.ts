import { eq } from "drizzle-orm";
import { agencySettings } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import { DEFAULT_SETTINGS, mergeOverDefaults, type Settings } from "@/lib/settings-defaults";

/** The raw stored values for an agency (empty object when none are stored). */
export async function readStoredSettings(agencyId: string): Promise<Record<string, unknown>> {
  const [row] = await withAgency(agencyId, (tx) =>
    tx.select({ values: agencySettings.values }).from(agencySettings).where(eq(agencySettings.agencyId, agencyId)),
  );
  const values = row?.values;
  return values && typeof values === "object" && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
}

/** The agency's settings: stored values merged over the spec defaults. Server only. */
export async function getSettings(agencyId: string): Promise<Settings> {
  return mergeOverDefaults(DEFAULT_SETTINGS, await readStoredSettings(agencyId));
}
