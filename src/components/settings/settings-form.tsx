"use client";

import { useState, useTransition } from "react";
import { updateSettings, type SettingsPatch } from "@/lib/settings/actions";
import {
  APPROVAL_AUTO_WARNING,
  DECISION_MAKER_RULES,
  STAGE_KEYS,
  WEEKDAYS,
  type DecisionMakerRule,
  type Settings,
  type StageKey,
  type Weekday,
} from "@/lib/settings-defaults";
import { Section } from "@/components/mpc/section";
import { fieldClass, primaryButton, quietButton } from "@/components/mpc/ui";

const DAY_LABEL: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
const RULE_LABEL: Record<DecisionMakerRule, string> = {
  reports_to: "The person the role reports to",
  local_team_leader: "Local team leader",
  function_head: "Head of the function",
  most_senior: "Most senior person",
};
const STAGE_LABEL: Record<StageKey, string> = {
  replied_interested: "Replied, interested",
  call_booked: "Call booked",
  resume_sent: "Resume sent",
  agreement_sent: "Agreement sent",
  agreement_signed: "Agreement signed",
};
const TEMPLATE_FIELDS = [
  ["pitch", "Pitch", "The first email about a candidate. Placeholders in [brackets] are filled for each prospect."],
  ["followUp1", "Follow-up", "The one-touch follow-up sent when there is no reply."],
  ["breakup", "Break-up", "The last email in the sequence."],
  ["optOut", "Opt-out line", "Added to every pitch so people can ask to be removed."],
] as const;
const REPEAT_OPTIONS = [14, 30, 60, 90];
const TIME_ZONES = [
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "UTC",
];

type Draft = {
  timeZone: string;
  sendDays: Weekday[];
  start: string;
  end: string;
  minSpacingMinutes: string;
  repeatWindowDays: string;
  repeatCustom: boolean;
  stalePostingDays: string;
  postalAddress: string;
  largeFirmList: string;
  excludeRecruitingIndustry: boolean;
  decisionMakerPriority: DecisionMakerRule[];
  hrFallback: boolean;
  averageFee: string;
  stageChances: Record<StageKey, string>;
  templates: Settings["templates"];
  approvalMode: "manual" | "auto";
};

function toDraft(s: Settings): Draft {
  return {
    timeZone: s.timeZone,
    sendDays: s.sendDays,
    start: s.sendWindow.start,
    end: s.sendWindow.end,
    minSpacingMinutes: String(s.minSpacingMinutes),
    repeatWindowDays: String(s.repeatWindowDays),
    repeatCustom: !REPEAT_OPTIONS.includes(s.repeatWindowDays),
    stalePostingDays: String(s.stalePostingDays),
    postalAddress: s.postalAddress ?? "",
    largeFirmList: s.largeFirmList.join("\n"),
    excludeRecruitingIndustry: s.excludeRecruitingIndustry,
    decisionMakerPriority: s.decisionMakerPriority,
    hrFallback: s.hrFallback,
    averageFee: s.averageFee === null ? "" : String(s.averageFee),
    stageChances: Object.fromEntries(STAGE_KEYS.map((k) => [k, String(s.stageChances[k])])) as Record<StageKey, string>,
    templates: s.templates,
    approvalMode: s.approvalMode,
  };
}

const num = (text: string) => (text.trim() === "" ? Number.NaN : Number(text.replace(/[$,\s]/g, "")));

function toPatch(d: Draft, confirmed: boolean): SettingsPatch {
  return {
    timeZone: d.timeZone.trim(),
    sendDays: d.sendDays,
    sendWindow: { start: d.start, end: d.end },
    minSpacingMinutes: num(d.minSpacingMinutes),
    repeatWindowDays: num(d.repeatWindowDays),
    stalePostingDays: num(d.stalePostingDays),
    postalAddress: d.postalAddress.trim() === "" ? null : d.postalAddress,
    largeFirmList: d.largeFirmList.split("\n").filter((line) => line.trim() !== ""),
    excludeRecruitingIndustry: d.excludeRecruitingIndustry,
    decisionMakerPriority: d.decisionMakerPriority,
    hrFallback: d.hrFallback,
    averageFee: d.averageFee.trim() === "" ? null : num(d.averageFee),
    stageChances: Object.fromEntries(STAGE_KEYS.map((k) => [k, num(d.stageChances[k])])) as Record<StageKey, number>,
    templates: d.templates,
    approvalMode: d.approvalMode,
    approvalModeConfirmed: confirmed,
  };
}

function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-xs text-muted ${wide ? "md:col-span-2" : ""}`}>
      {label}
      {children}
      <span className="text-xs text-muted [overflow-wrap:anywhere]">{hint}</span>
    </label>
  );
}

function Check({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex min-w-0 items-start gap-3 text-sm text-text md:col-span-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-gold"
      />
      <span className="flex min-w-0 flex-col gap-1">
        {label}
        <span className="text-xs text-muted [overflow-wrap:anywhere]">{hint}</span>
      </span>
    </label>
  );
}

const grid = "grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2";

export function SettingsForm({ settings, canEdit }: { settings: Settings; canEdit: boolean }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const ro = !canEdit;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const switchingToAuto = draft.approvalMode === "auto" && settings.approvalMode !== "auto";

  function toggleDay(day: Weekday, on: boolean) {
    set("sendDays", WEEKDAYS.filter((d) => (d === day ? on : draft.sendDays.includes(d))));
  }
  function moveRule(index: number, by: -1 | 1) {
    const next = [...draft.decisionMakerPriority];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set("decisionMakerPriority", next);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (switchingToAuto && !confirmed) {
      setError(APPROVAL_AUTO_WARNING);
      return;
    }
    start(async () => {
      const result = await updateSettings(toPatch(draft, confirmed));
      if (result.ok) {
        setSaved(true);
        setConfirmed(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex min-w-0 flex-col gap-6" aria-label="Agency settings">
      {ro && (
        <p className="rounded border border-line bg-card p-4 text-sm text-text-soft">
          Only the Owner and Admins can change settings. You can see the current values here.
        </p>
      )}

      <Section title="Agency">
        <div className={grid}>
          <Field label="Time zone" hint="Send times and the daily list follow this zone.">
            <input
              name="timeZone"
              list="time-zones"
              value={draft.timeZone}
              disabled={ro}
              onChange={(e) => set("timeZone", e.target.value)}
              className={fieldClass}
            />
            <datalist id="time-zones">
              {TIME_ZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </Field>
          <fieldset className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            <legend className="mb-1">Send days</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => (
                <label key={day} className="flex min-h-11 items-center gap-2 rounded border border-line px-3 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={draft.sendDays.includes(day)}
                    disabled={ro}
                    onChange={(e) => toggleDay(day, e.target.checked)}
                    className="size-4 accent-gold"
                  />
                  {DAY_LABEL[day]}
                </label>
              ))}
            </div>
            <span className="text-xs text-muted">Emails only go out on these days.</span>
          </fieldset>
          <Field label="Send window starts" hint="No email goes out before this time.">
            <input type="time" value={draft.start} disabled={ro} onChange={(e) => set("start", e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Send window ends" hint="No email goes out after this time.">
            <input type="time" value={draft.end} disabled={ro} onChange={(e) => set("end", e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Minutes between sends" hint="At least 4 minutes between emails from one inbox.">
            <input
              type="number"
              min={4}
              step={1}
              inputMode="numeric"
              value={draft.minSpacingMinutes}
              disabled={ro}
              onChange={(e) => set("minSpacingMinutes", e.target.value)}
              className={fieldClass}
            />
          </Field>
          <Field label="New pitches per inbox per day" hint="Calculated by RGE from inbox health. Not editable.">
            <input readOnly disabled value={settings.newPitchCapPerInbox} className={fieldClass} />
          </Field>
          <Field label="Warm-up start per day" hint="Calculated by RGE for a new inbox. Not editable.">
            <input readOnly disabled value={settings.warmupStartPerDay} className={fieldClass} />
          </Field>
          <Field label="Repeat window" hint="Days before the same contact can be pitched again without your decision.">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <select
                aria-label="Repeat window preset"
                value={draft.repeatCustom ? "custom" : draft.repeatWindowDays}
                disabled={ro}
                onChange={(e) => {
                  if (e.target.value === "custom") set("repeatCustom", true);
                  else {
                    setSaved(false);
                    setDraft((d) => ({ ...d, repeatCustom: false, repeatWindowDays: e.target.value }));
                  }
                }}
                className={fieldClass}
              >
                {REPEAT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} days
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
              {draft.repeatCustom && (
                <input
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  inputMode="numeric"
                  aria-label="Repeat window in days"
                  value={draft.repeatWindowDays}
                  disabled={ro}
                  onChange={(e) => set("repeatWindowDays", e.target.value)}
                  className={fieldClass}
                />
              )}
            </div>
          </Field>
          <Field label="Stale posting age (days)" hint="A job posting older than this is not treated as a live opening.">
            <input
              type="number"
              min={1}
              max={365}
              step={1}
              inputMode="numeric"
              value={draft.stalePostingDays}
              disabled={ro}
              onChange={(e) => set("stalePostingDays", e.target.value)}
              className={fieldClass}
            />
          </Field>
          <Field wide label="Postal address" hint="Shown in the footer of every email. Leave blank if you do not need one yet.">
            <textarea
              rows={3}
              maxLength={300}
              value={draft.postalAddress}
              disabled={ro}
              onChange={(e) => set("postalAddress", e.target.value)}
              className={`${fieldClass} py-2`}
            />
          </Field>
        </div>
      </Section>

      <Section title="Rules">
        <div className={grid}>
          <Field wide label="Large firms" hint="One firm per line. Repeat pitches to these firms are allowed; every other firm needs your decision.">
            <textarea
              rows={6}
              value={draft.largeFirmList}
              disabled={ro}
              onChange={(e) => set("largeFirmList", e.target.value)}
              className={`${fieldClass} py-2`}
            />
          </Field>
          <Check
            label="Skip recruiting and staffing firms"
            hint="Keeps recruiting agencies out of prospect research."
            checked={draft.excludeRecruitingIndustry}
            disabled={ro}
            onChange={(v) => set("excludeRecruitingIndustry", v)}
          />
          <fieldset className="flex min-w-0 flex-col gap-2 text-xs text-muted md:col-span-2">
            <legend className="mb-1">Who to contact first</legend>
            <ol className="flex min-w-0 flex-col gap-2">
              {draft.decisionMakerPriority.map((rule, i) => (
                <li key={rule} className="flex min-w-0 items-center justify-between gap-2 rounded border border-line px-3 py-2">
                  <span className="min-w-0 text-sm text-text [overflow-wrap:anywhere]">
                    {i + 1}. {RULE_LABEL[rule]}
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      aria-label={`Move ${RULE_LABEL[rule]} up`}
                      disabled={ro || i === 0}
                      onClick={() => moveRule(i, -1)}
                      className={quietButton}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${RULE_LABEL[rule]} down`}
                      disabled={ro || i === DECISION_MAKER_RULES.length - 1}
                      onClick={() => moveRule(i, 1)}
                      className={quietButton}
                    >
                      Down
                    </button>
                  </span>
                </li>
              ))}
            </ol>
            <span className="text-xs text-muted">RGE tries these in order to choose the decision maker at a firm.</span>
          </fieldset>
          <Check
            label="Fall back to HR"
            hint="If no decision maker is found, contact someone in HR instead."
            checked={draft.hrFallback}
            disabled={ro}
            onChange={(v) => set("hrFallback", v)}
          />
        </div>
      </Section>

      <Section title="CRM">
        <div className={grid}>
          <Field label="Average fee (dollars)" hint="Used to estimate the value of your pipeline. Leave blank until you know it.">
            <input
              inputMode="numeric"
              value={draft.averageFee}
              disabled={ro}
              onChange={(e) => set("averageFee", e.target.value)}
              className={fieldClass}
            />
          </Field>
          <div className="hidden md:block" />
          {STAGE_KEYS.map((key) => (
            <Field
              key={key}
              label={`${STAGE_LABEL[key]} (%)`}
              hint={
                key === "agreement_signed"
                  ? "Chance a deal at this stage turns into a placement. Always 100."
                  : "Chance a deal at this stage turns into a placement. Must not drop from the stage before."
              }
            >
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                value={draft.stageChances[key]}
                disabled={ro}
                onChange={(e) => set("stageChances", { ...draft.stageChances, [key]: e.target.value })}
                className={fieldClass}
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Templates">
        <div className="grid min-w-0 grid-cols-1 gap-4">
          {TEMPLATE_FIELDS.map(([key, label, hint]) => (
            <Field key={key} label={label} hint={hint}>
              <textarea
                rows={key === "followUp1" || key === "optOut" ? 3 : 8}
                value={draft.templates[key]}
                disabled={ro}
                onChange={(e) => set("templates", { ...draft.templates, [key]: e.target.value })}
                className={`${fieldClass} py-2 font-mono`}
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Approvals">
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="Approval mode" hint="Manual means you approve the exact email before anything is sent.">
            <select
              value={draft.approvalMode}
              disabled={ro}
              onChange={(e) => {
                setConfirmed(false);
                set("approvalMode", e.target.value as "manual" | "auto");
              }}
              className={fieldClass}
            >
              <option value="manual">Manual</option>
              <option value="auto">Auto</option>
            </select>
          </Field>
          {switchingToAuto && !ro && (
            <div role="alert" className="flex min-w-0 flex-col gap-3 rounded border border-flag p-4 text-sm text-text">
              <p>{APPROVAL_AUTO_WARNING}</p>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 size-5 shrink-0 accent-gold"
                />
                I understand and want to turn on Auto.
              </label>
            </div>
          )}
        </div>
      </Section>

      {!ro && (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? "Saving" : "Save settings"}
            </button>
            {saved && (
              <p role="status" className="text-sm text-ok">
                Settings saved.
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-deny [overflow-wrap:anywhere]">
              {error}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
