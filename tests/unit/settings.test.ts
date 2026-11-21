import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { agencies, agencySettings } from "@/db/schema";
import { DEFAULT_SETTINGS, APPROVAL_AUTO_WARNING } from "@/lib/settings-defaults";
import { getSettings } from "@/lib/settings/get";
import { updateSettings } from "@/lib/settings/actions";
import type { Member } from "@/lib/auth";
import { asOwner, createTestDb, seedAgencies, type TestDb } from "../helpers/test-db";
import { asMember, membersOf, seedMembers, type MemberFixtures } from "../helpers/as-member";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: TestDb;
let close: (() => Promise<void>) | undefined;
let f: MemberFixtures;

const updateSettingsAs = (m: Member, patch: Parameters<typeof updateSettings>[0]) =>
  asMember(m, () => updateSettings(patch));
const getSettingsFor = (agencyId: string) => getSettings(agencyId);
const dash = "—";

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  const t = await createTestDb();
  db = t.db;
  close = t.close;
  f = await seedMembers(db);
});
afterEach(async () => {
  await close?.();
});

describe("defaults", () => {
  test("defaults apply when nothing is stored", async () => {
    const s = await getSettingsFor(f.agency.id);
    expect(s.repeatWindowDays).toBe(60);
    expect(s.stageChances.call_booked).toBe(25);
    expect(s.templates.optOut).toBe("Prefer not to receive these candidate introductions? Reply 'stop' and I'll remove you.");
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  test("default templates contain no em dashes", () => {
    expect(JSON.stringify(DEFAULT_SETTINGS)).not.toContain(dash);
  });

  test("stored values merge over defaults per nested key, arrays replace, unknown keys are ignored", async () => {
    await asOwner(db, (tx) =>
      tx.insert(agencySettings).values({
        agencyId: f.agency.id,
        values: {
          repeatWindowDays: 30,
          stageChances: { call_booked: 30 },
          sendWindow: { end: "16:00" },
          sendDays: ["mon"],
          bogus: 1,
          templates: { followUp1: "Hey, any thoughts?", extra: "x" },
        },
      }),
    );
    const s = await getSettingsFor(f.agency.id);
    expect(s.repeatWindowDays).toBe(30);
    expect(s.stageChances).toEqual({ ...DEFAULT_SETTINGS.stageChances, call_booked: 30 });
    expect(s.sendWindow).toEqual({ start: "09:00", end: "16:00" });
    expect(s.sendDays).toEqual(["mon"]);
    expect(s.templates.followUp1).toBe("Hey, any thoughts?");
    expect(s.templates.pitch).toBe(DEFAULT_SETTINGS.templates.pitch);
    expect(s).not.toHaveProperty("bogus");
    expect(s.templates).not.toHaveProperty("extra");
  });

  test("another agency's settings are not visible", async () => {
    const [other] = await seedAgencies(db, 1);
    await updateSettingsAs(f.owner, { repeatWindowDays: 14 });
    expect((await getSettingsFor(other.id)).repeatWindowDays).toBe(60);
  });
});

describe("who can update", () => {
  test("recruiter cannot update settings", async () => {
    expect((await updateSettingsAs(f.recA, { repeatWindowDays: 30 })).ok).toBe(false);
    expect((await getSettingsFor(f.agency.id)).repeatWindowDays).toBe(60);
  });
  test("owner and admin can", async () => {
    expect(await updateSettingsAs(f.owner, { repeatWindowDays: 30 })).toEqual({ ok: true });
    expect(await updateSettingsAs(f.admin, { repeatWindowDays: 90 })).toEqual({ ok: true });
    expect((await getSettingsFor(f.agency.id)).repeatWindowDays).toBe(90);
  });
  test("a member of another agency changes only their own", async () => {
    const [other] = await seedAgencies(db, 1);
    await updateSettingsAs(membersOf(other).owner, { repeatWindowDays: 14 });
    expect((await getSettingsFor(f.agency.id)).repeatWindowDays).toBe(60);
    expect((await getSettingsFor(other.id)).repeatWindowDays).toBe(14);
  });
});

describe("saving", () => {
  test("persists, merges partial nested patches and revalidates /settings", async () => {
    expect(await updateSettingsAs(f.owner, { stageChances: { call_booked: 30 } })).toEqual({ ok: true });
    expect(await updateSettingsAs(f.owner, { sendWindow: { start: "08:30" } })).toEqual({ ok: true });
    const s = await getSettingsFor(f.agency.id);
    expect(s.stageChances).toEqual({ ...DEFAULT_SETTINGS.stageChances, call_booked: 30 });
    expect(s.sendWindow).toEqual({ start: "08:30", end: "17:00" });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });
  test("a failed save does not revalidate or store", async () => {
    await updateSettingsAs(f.owner, { repeatWindowDays: 0 });
    expect(revalidatePath).not.toHaveBeenCalled();
    const rows = await asOwner(db, (tx) => tx.select().from(agencySettings));
    expect(rows).toHaveLength(0);
  });
  test("time zone keeps agencies.time_zone in sync", async () => {
    expect(await updateSettingsAs(f.owner, { timeZone: "America/New_York" })).toEqual({ ok: true });
    const [row] = await asOwner(db, (tx) => tx.select().from(agencies).where(eq(agencies.id, f.agency.id)));
    expect(row.timeZone).toBe("America/New_York");
    expect((await getSettingsFor(f.agency.id)).timeZone).toBe("America/New_York");
  });
  test("invalid time zone is rejected", async () => {
    expect((await updateSettingsAs(f.owner, { timeZone: "Mars/Olympus" })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { timeZone: "" })).ok).toBe(false);
  });
  test("unknown keys are rejected", async () => {
    const r = await updateSettingsAs(f.owner, { bogus: 1 } as never);
    expect(r.ok).toBe(false);
  });
});

describe("templates", () => {
  test("em dash in a template is rejected", async () => {
    expect(
      await updateSettingsAs(f.owner, { templates: { ...DEFAULT_SETTINGS.templates, breakup: `Hi ${dash} there` } }),
    ).toEqual({
      ok: false,
      error: "Remove em dashes from the template.",
    });
  });
  test("em dash in the opt-out line is rejected", async () => {
    expect(await updateSettingsAs(f.owner, { templates: { optOut: `Reply stop ${dash} done` } })).toEqual({
      ok: false,
      error: "Remove em dashes from the template.",
    });
  });
  test("empty templates and opt-out are rejected", async () => {
    expect((await updateSettingsAs(f.owner, { templates: { pitch: "   " } })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { templates: { optOut: "" } })).ok).toBe(false);
  });
  test("a valid template saves", async () => {
    expect(await updateSettingsAs(f.owner, { templates: { followUp1: "Any thoughts?" } })).toEqual({ ok: true });
    expect((await getSettingsFor(f.agency.id)).templates.followUp1).toBe("Any thoughts?");
  });
});

describe("numbers", () => {
  test("repeat window must be 1 to 365 days", async () => {
    expect((await updateSettingsAs(f.owner, { repeatWindowDays: 0 })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { repeatWindowDays: 366 })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { repeatWindowDays: 1.5 })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { repeatWindowDays: 1 })).ok).toBe(true);
    expect((await updateSettingsAs(f.owner, { repeatWindowDays: 365 })).ok).toBe(true);
  });
  test("stale posting age must be 1 to 365 days", async () => {
    expect((await updateSettingsAs(f.owner, { stalePostingDays: 0 })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { stalePostingDays: 400 })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { stalePostingDays: 120 })).ok).toBe(true);
  });
  test("stage chances must rise and end at 100", async () => {
    const msg = "Stage chances must rise from stage to stage and end at 100.";
    expect(await updateSettingsAs(f.owner, { stageChances: { call_booked: 5 } })).toEqual({ ok: false, error: msg });
    expect(await updateSettingsAs(f.owner, { stageChances: { agreement_signed: 90 } })).toEqual({
      ok: false,
      error: msg,
    });
    expect((await updateSettingsAs(f.owner, { stageChances: { replied_interested: 101 } })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { stageChances: { replied_interested: 10.5 } })).ok).toBe(false);
    expect(await updateSettingsAs(f.owner, { stageChances: { call_booked: 30, resume_sent: 30 } })).toEqual({
      ok: true,
    });
  });
  test("average fee is null or whole dollars above zero", async () => {
    expect((await updateSettingsAs(f.owner, { averageFee: 0 })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { averageFee: 12000.5 })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { averageFee: 25000 })).ok).toBe(true);
    expect((await getSettingsFor(f.agency.id)).averageFee).toBe(25000);
    expect((await updateSettingsAs(f.owner, { averageFee: null })).ok).toBe(true);
    expect((await getSettingsFor(f.agency.id)).averageFee).toBeNull();
  });
  test("spacing must be at least 4 minutes", async () => {
    expect(await updateSettingsAs(f.owner, { minSpacingMinutes: 3 })).toEqual({
      ok: false,
      error: "Sends must be at least 4 minutes apart.",
    });
    expect((await updateSettingsAs(f.owner, { minSpacingMinutes: 5.5 })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { minSpacingMinutes: 6 })).ok).toBe(true);
  });
  test("pitch cap and warm-up are calculated by RGE and cannot be changed", async () => {
    expect((await updateSettingsAs(f.owner, { newPitchCapPerInbox: 80 } as never)).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { warmupStartPerDay: 20 } as never)).ok).toBe(false);
    expect((await getSettingsFor(f.agency.id)).newPitchCapPerInbox).toBe(40);
  });
});

describe("send schedule", () => {
  test("window start must be before end and be HH:MM", async () => {
    expect((await updateSettingsAs(f.owner, { sendWindow: { start: "17:00", end: "09:00" } })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { sendWindow: { start: "09:00", end: "09:00" } })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { sendWindow: { start: "9:00" } })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { sendWindow: { end: "24:00" } })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { sendWindow: { start: "08:00", end: "16:30" } })).ok).toBe(true);
  });
  test("send days must be a non-empty set of weekdays", async () => {
    expect((await updateSettingsAs(f.owner, { sendDays: [] })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { sendDays: ["funday"] as never })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { sendDays: ["fri", "mon", "mon"] })).ok).toBe(true);
    expect((await getSettingsFor(f.agency.id)).sendDays).toEqual(["mon", "fri"]);
  });
});

describe("rules and address", () => {
  test("large firm list is trimmed and de-duplicated", async () => {
    expect(await updateSettingsAs(f.owner, { largeFirmList: ["  Acme LLP ", "acme llp", "Beta & Co"] })).toEqual({
      ok: true,
    });
    expect((await getSettingsFor(f.agency.id)).largeFirmList).toEqual(["Acme LLP", "Beta & Co"]);
  });
  test("large firm entries must be 1 to 120 characters", async () => {
    expect((await updateSettingsAs(f.owner, { largeFirmList: ["   "] })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { largeFirmList: ["x".repeat(121)] })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { largeFirmList: ["x".repeat(120)] })).ok).toBe(true);
  });
  test("postal address is null or 5 to 300 characters", async () => {
    expect((await updateSettingsAs(f.owner, { postalAddress: "1 A" })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { postalAddress: "x".repeat(301) })).ok).toBe(false);
    expect((await updateSettingsAs(f.owner, { postalAddress: "100 Main St, Phoenix, AZ 85001" })).ok).toBe(true);
    expect((await getSettingsFor(f.agency.id)).postalAddress).toBe("100 Main St, Phoenix, AZ 85001");
    expect((await updateSettingsAs(f.owner, { postalAddress: null })).ok).toBe(true);
    expect((await getSettingsFor(f.agency.id)).postalAddress).toBeNull();
  });
  test("decision maker priority must list each of the four rules once", async () => {
    expect((await updateSettingsAs(f.owner, { decisionMakerPriority: ["reports_to"] })).ok).toBe(false);
    expect(
      (
        await updateSettingsAs(f.owner, {
          decisionMakerPriority: ["most_senior", "reports_to", "reports_to", "function_head"],
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await updateSettingsAs(f.owner, {
          decisionMakerPriority: ["most_senior", "function_head", "local_team_leader", "reports_to"],
        })
      ).ok,
    ).toBe(true);
  });
});

describe("approval mode", () => {
  test("switching to auto needs the explicit confirm", async () => {
    expect(await updateSettingsAs(f.owner, { approvalMode: "auto" })).toEqual({
      ok: false,
      error: APPROVAL_AUTO_WARNING,
    });
    expect(APPROVAL_AUTO_WARNING).toBe(
      "Emails will send without your review. You are responsible for every message sent from your account.",
    );
    expect((await getSettingsFor(f.agency.id)).approvalMode).toBe("manual");
    expect(await updateSettingsAs(f.owner, { approvalMode: "auto", approvalModeConfirmed: true })).toEqual({
      ok: true,
    });
    expect((await getSettingsFor(f.agency.id)).approvalMode).toBe("auto");
    expect(await getSettingsFor(f.agency.id)).not.toHaveProperty("approvalModeConfirmed");
  });
  test("switching back to manual needs no confirm", async () => {
    await updateSettingsAs(f.owner, { approvalMode: "auto", approvalModeConfirmed: true });
    expect(await updateSettingsAs(f.owner, { approvalMode: "manual" })).toEqual({ ok: true });
  });
  test("other edits while already on auto need no confirm", async () => {
    await updateSettingsAs(f.owner, { approvalMode: "auto", approvalModeConfirmed: true });
    expect(await updateSettingsAs(f.owner, { approvalMode: "auto", repeatWindowDays: 30 })).toEqual({ ok: true });
  });
  test("an invalid mode is rejected", async () => {
    expect((await updateSettingsAs(f.owner, { approvalMode: "yolo" as never })).ok).toBe(false);
  });
});
