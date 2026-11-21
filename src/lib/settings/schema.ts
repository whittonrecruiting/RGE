import { z } from "zod";
import { DECISION_MAKER_RULES, STAGE_KEYS, WEEKDAYS } from "@/lib/settings-defaults";

export const EM_DASH_MESSAGE = "Remove em dashes from the template.";
export const STAGE_MESSAGE = "Stage chances must rise from stage to stage and end at 100.";
export const SPACING_MESSAGE = "Sends must be at least 4 minutes apart.";

const days365 = (what: string) =>
  z
    .number({ error: `${what} must be a whole number of days from 1 to 365.` })
    .int(`${what} must be a whole number of days from 1 to 365.`)
    .min(1, `${what} must be a whole number of days from 1 to 365.`)
    .max(365, `${what} must be a whole number of days from 1 to 365.`);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24 hour times like 09:00.");

const isValidZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const template = (label: string) =>
  z
    .string({ error: `${label} cannot be empty.` })
    .superRefine((value, ctx) => {
      if (value.includes("—")) ctx.addIssue({ code: "custom", message: EM_DASH_MESSAGE });
      else if (value.trim() === "") ctx.addIssue({ code: "custom", message: `${label} cannot be empty.` });
      else if (value.length > 5000) ctx.addIssue({ code: "custom", message: `${label} is too long.` });
    });

const stagePercent = z
  .number({ error: "Stage chances must be whole numbers from 0 to 100." })
  .int("Stage chances must be whole numbers from 0 to 100.")
  .min(0, "Stage chances must be whole numbers from 0 to 100.")
  .max(100, "Stage chances must be whole numbers from 0 to 100.");

/** Validates and normalizes one complete settings object (stored values already merged over defaults). */
export const settingsSchema = z.object({
  timeZone: z.string().refine((z) => z.length > 0 && isValidZone(z), "Choose a valid time zone."),
  sendDays: z
    .array(z.enum(WEEKDAYS, { error: "Choose send days from Monday to Sunday." }))
    .min(1, "Choose at least one send day.")
    .transform((list) => WEEKDAYS.filter((d) => list.includes(d))),
  sendWindow: z
    .object({ start: hhmm, end: hhmm })
    .refine((w) => w.start < w.end, "The send window must start before it ends."),
  minSpacingMinutes: z
    .number({ error: SPACING_MESSAGE })
    .int(SPACING_MESSAGE)
    .min(4, SPACING_MESSAGE),
  newPitchCapPerInbox: z.number(),
  warmupStartPerDay: z.number(),
  repeatWindowDays: days365("The repeat window"),
  stalePostingDays: days365("The stale posting age"),
  excludeRecruitingIndustry: z.boolean(),
  largeFirmList: z
    .array(
      z
        .string()
        .transform((s) => s.trim())
        .pipe(z.string().min(1, "Firm names cannot be blank.").max(120, "Firm names must be 120 characters or fewer.")),
    )
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((name) => {
        const key = name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }),
  decisionMakerPriority: z
    .array(z.enum(DECISION_MAKER_RULES))
    .refine(
      (list) => list.length === DECISION_MAKER_RULES.length && new Set(list).size === DECISION_MAKER_RULES.length,
      "List each decision-maker rule once.",
    ),
  hrFallback: z.boolean(),
  averageFee: z
    .number({ error: "The average fee must be whole dollars above zero." })
    .int("The average fee must be whole dollars above zero.")
    .min(1, "The average fee must be whole dollars above zero.")
    .nullable(),
  stageChances: z
    .object(Object.fromEntries(STAGE_KEYS.map((k) => [k, stagePercent])) as Record<(typeof STAGE_KEYS)[number], typeof stagePercent>)
    .superRefine((chances, ctx) => {
      const values = STAGE_KEYS.map((k) => chances[k]);
      const rises = values.every((v, i) => i === 0 || v >= values[i - 1]);
      if (!rises || chances.agreement_signed !== 100) ctx.addIssue({ code: "custom", message: STAGE_MESSAGE });
    }),
  approvalMode: z.enum(["manual", "auto"], { error: "Choose manual or auto approval." }),
  postalAddress: z
    .string({ error: "The postal address must be 5 to 300 characters." })
    .nullable()
    .transform((s) => (s === null || s.trim() === "" ? null : s.trim()))
    .pipe(z.string().min(5, "The postal address must be 5 to 300 characters.").max(300, "The postal address must be 5 to 300 characters.").nullable()),
  templates: z.object({
    pitch: template("The pitch template"),
    followUp1: template("The follow-up template"),
    breakup: template("The break-up template"),
    optOut: template("The opt-out line"),
  }),
});

export type ParsedSettings = z.output<typeof settingsSchema>;
