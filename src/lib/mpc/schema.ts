import { z } from "zod";

export const WORK_MODES = ["onsite", "hybrid", "remote", "any"] as const;
export const EMPLOYER_TYPES = ["inhouse", "firm", "either"] as const;
export const MPC_STATUSES = ["active", "paused", "removed", "placed"] as const;
export type MpcStatus = (typeof MPC_STATUSES)[number];
/** Statuses a recruiter may set from the UI. Placed is set by the placement flow, never here. */
export type SettableStatus = Exclude<MpcStatus, "placed">;

const MAX_TEXT = 120;
const MAX_YEARS = 70;
const MAX_DOLLARS = 10_000_000;

/** Form fields arrive as text. Blank means "not set". */
const blankToNull = (v: unknown) => (v === "" || v === undefined || v === null ? null : v);
const numeric = (v: unknown) => {
  const x = blankToNull(v);
  return typeof x === "string" ? (x.trim() === "" ? null : Number(x.replace(/[$,\s]/g, ""))) : x;
};

const optionalInt = (max: number, label: string, unit: string) =>
  z.preprocess(
    numeric,
    z
      .number({ error: `${label} must be a number.` })
      .int({ error: `${label} must be ${unit}.` })
      .min(0, { error: `${label} cannot be negative.` })
      .max(max, { error: `${label} is too large.` })
      .nullable(),
  );

/** Comma-separated text or an array, stored as trimmed, de-duplicated, non-empty strings. */
const list = z.preprocess(
  (v) => (typeof v === "string" ? v.split(",") : v ?? []),
  z.array(z.string()).transform((items) => {
    const seen = new Set<string>();
    for (const item of items) {
      const t = item.trim();
      if (t) seen.add(t);
    }
    return [...seen];
  }),
);

const requiredText = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, { error: `${label} is required.` })
    .max(MAX_TEXT, { error: `${label} must be ${MAX_TEXT} characters or fewer.` });

/** The editable profile fields of an MPC. */
export const mpcInput = z
  .object({
    headlineRole: requiredText("Headline role"),
    location: requiredText("Location"),
    yearsExperience: optionalInt(MAX_YEARS, "Years of experience", "a whole number").default(null),
    seniority: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(MAX_TEXT, { error: `Seniority must be ${MAX_TEXT} characters or fewer.` }).nullable(),
    ).default(null),
    specialtyTags: list,
    workMode: z.enum(WORK_MODES, { error: "Choose a work mode." }).default("any"),
    employerType: z.enum(EMPLOYER_TYPES, { error: "Choose an employer type." }).default("either"),
    targetCities: list,
    payFloor: optionalInt(MAX_DOLLARS, "Pay floor", "whole dollars").default(null),
    payFloorStrict: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
    payTarget: optionalInt(MAX_DOLLARS, "Pay target", "whole dollars").default(null),
    overlapPriority: z.preprocess(
      (v) => numeric(v) ?? 0,
      z
        .number({ error: "Overlap priority must be a number." })
        .int({ error: "Overlap priority must be a whole number." })
        .min(0, { error: "Overlap priority cannot be negative." })
        .max(1000, { error: "Overlap priority is too large." }),
    ),
  })
  .refine((v) => v.payFloor === null || v.payTarget === null || v.payFloor <= v.payTarget, {
    path: ["payFloor"],
    error: "Pay floor cannot be above pay target.",
  });

type NumberLike = number | string | null;
/** What callers pass in: numbers may be text from a form, lists may be comma-separated text, optional fields may be omitted. */
export type MpcInput = {
  headlineRole: string;
  location: string;
  yearsExperience?: NumberLike;
  seniority?: string | null;
  specialtyTags?: string | string[];
  workMode?: (typeof WORK_MODES)[number];
  employerType?: (typeof EMPLOYER_TYPES)[number];
  targetCities?: string | string[];
  payFloor?: NumberLike;
  payFloorStrict?: boolean | string;
  payTarget?: NumberLike;
  overlapPriority?: NumberLike;
};
export type MpcFields = z.output<typeof mpcInput>;
