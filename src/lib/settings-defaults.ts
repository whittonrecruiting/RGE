export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const DECISION_MAKER_RULES = ["reports_to", "local_team_leader", "function_head", "most_senior"] as const;
export type DecisionMakerRule = (typeof DECISION_MAKER_RULES)[number];

export const STAGE_KEYS = [
  "replied_interested",
  "call_booked",
  "resume_sent",
  "agreement_sent",
  "agreement_signed",
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const APPROVAL_AUTO_WARNING =
  "Emails will send without your review. You are responsible for every message sent from your account.";

export type Settings = {
  timeZone: string;
  sendDays: Weekday[];
  sendWindow: { start: string; end: string };
  minSpacingMinutes: number;
  newPitchCapPerInbox: number;
  warmupStartPerDay: number;
  repeatWindowDays: number;
  stalePostingDays: number;
  excludeRecruitingIndustry: boolean;
  largeFirmList: string[];
  decisionMakerPriority: DecisionMakerRule[];
  hrFallback: boolean;
  averageFee: number | null;
  stageChances: Record<StageKey, number>;
  approvalMode: "manual" | "auto";
  postalAddress: string | null;
  templates: { pitch: string; followUp1: string; breakup: string; optOut: string };
};

export const DEFAULT_SETTINGS: Settings = {
  timeZone: "America/Phoenix",
  sendDays: ["mon", "tue", "wed", "thu"],
  sendWindow: { start: "09:00", end: "17:00" },
  minSpacingMinutes: 4,
  newPitchCapPerInbox: 40,
  warmupStartPerDay: 10,
  repeatWindowDays: 60, // options 14, 30, 60, 90, or custom
  stalePostingDays: 90,
  excludeRecruitingIndustry: true,
  largeFirmList: [],
  decisionMakerPriority: ["reports_to", "local_team_leader", "function_head", "most_senior"],
  hrFallback: false,
  averageFee: null,
  stageChances: { replied_interested: 10, call_booked: 25, resume_sent: 40, agreement_sent: 65, agreement_signed: 100 },
  approvalMode: "manual",
  postalAddress: null,
  templates: {
    pitch:
      "Hi [First Name],\n\nI'm working with a [location] [role type] whose [specific background] could be relevant to your team:\n\n- [bullet]\n- [bullet]\n- [bullet]\n\nWould you be open to a call to discuss?\n\nBest,",
    followUp1: "Hey [First Name], thoughts on this candidate?",
    breakup:
      "Hi [First Name],\n\nLast email about this candidate. If I come across another candidate who could be a fit for your team, I'll reach out.\n\nBest,",
    optOut: "Prefer not to receive these candidate introductions? Reply 'stop' and I'll remove you.",
  },
};

/** Calculated by RGE later (warm-up and deliverability); shown read-only, never edited here. */
export const CALCULATED_KEYS = ["newPitchCapPerInbox", "warmupStartPerDay"] as const;

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Merges stored over defaults: nested objects merge per key, arrays and scalars replace, and
 * keys the defaults do not know are ignored. Stored values of the wrong shape fall back.
 */
export function mergeOverDefaults<T>(defaults: T, stored: unknown): T {
  if (!isPlain(defaults)) return (stored === undefined ? defaults : stored) as T;
  const source = isPlain(stored) ? stored : {};
  const out: Plain = {};
  for (const key of Object.keys(defaults)) {
    const base = defaults[key];
    const value = source[key];
    if (isPlain(base)) out[key] = mergeOverDefaults(base, value);
    else if (Array.isArray(base)) out[key] = Array.isArray(value) ? value : base;
    else out[key] = value === undefined ? base : value;
  }
  return out as T;
}
