"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyExtraction } from "@/lib/mpc/document-actions";
import type { ProfileDraft } from "@/lib/ai/extract-profile";
import type { MpcInput } from "@/lib/mpc/schema";
import { FlagBadge } from "./badges";
import { primaryButton, quietButton } from "./ui";

const FIELD_LABELS: Record<string, string> = {
  headlineRole: "Headline role",
  location: "Location",
  yearsExperience: "Years of experience",
  seniority: "Seniority",
  specialtyTags: "Specialty tags",
  workMode: "Work mode",
  employerType: "Employer type",
  targetCities: "Target cities",
};

const RESTRICTION_LABELS: Record<string, string> = {
  never_say: "Never say",
  confidential: "Confidential",
  excluded_company: "Excluded company",
  region_exclusion: "Excluded region",
};

const KIND_LABELS: Record<string, string> = { resume: "resume", notes: "notes", transcript: "transcript" };

const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));

const checkClass = "mt-0.5 size-5 shrink-0 accent-[var(--c-gold)]";
const rowClass = "flex min-w-0 items-start gap-3 rounded border border-line bg-surface p-3";

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * Shows what extraction proposed. Profile fields and facts start checked, restrictions start
 * unchecked. Save writes only the checked items.
 */
export function ExtractionReview({
  mpcId,
  draft,
  onClose,
}: {
  mpcId: string;
  draft: ProfileDraft;
  onClose: () => void;
}) {
  const router = useRouter();
  const fieldKeys = Object.keys(draft.fields) as (keyof MpcInput)[];
  const [fields, setFields] = useState(() => new Set<string>(fieldKeys));
  const [facts, setFacts] = useState(() => new Set<number>(draft.facts.map((_, i) => i)));
  const [restrictions, setRestrictions] = useState(() => new Set<number>());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const empty = fieldKeys.length === 0 && draft.facts.length === 0 && draft.restrictionsSuggested.length === 0;
  const checkedCount = fields.size + facts.size + restrictions.size;

  function save() {
    setError(null);
    const accepted: Partial<MpcInput> = {};
    for (const k of fieldKeys) if (fields.has(k)) (accepted as Record<string, unknown>)[k] = draft.fields[k];
    start(async () => {
      const result = await applyExtraction(mpcId, {
        draft,
        fields: accepted,
        factIndexes: [...facts],
        restrictionIndexes: [...restrictions],
      });
      if (result.ok) {
        router.refresh();
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 rounded border border-gold p-4" aria-label="Review extraction">
      <div>
        <h3 className="text-sm font-semibold text-text">Review what was found</h3>
        <p className="mt-1 text-sm text-text-soft">
          Only checked items are saved. Facts from notes and transcripts are saved as interview only until you confirm
          them.
        </p>
      </div>

      {empty && <p className="text-sm text-text-soft">Nothing usable was found in these documents.</p>}

      {fieldKeys.length > 0 && (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-soft">
            Profile fields
          </legend>
          {fieldKeys.map((k) => (
            <label key={k} className={rowClass}>
              <input
                type="checkbox"
                checked={fields.has(k)}
                onChange={() => setFields((s) => toggle(s, k))}
                className={checkClass}
              />
              <span className="min-w-0 text-sm text-text [overflow-wrap:anywhere]">
                <span className="block text-xs text-muted">{FIELD_LABELS[k] ?? k}</span>
                {show(draft.fields[k])}
                <span className="mt-1 block text-xs text-muted">Source: your documents</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {draft.facts.length > 0 && (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-soft">Facts</legend>
          {draft.facts.map((f, i) => (
            <label key={i} className={rowClass}>
              <input
                type="checkbox"
                checked={facts.has(i)}
                onChange={() => setFacts((s) => toggle(s, i))}
                className={checkClass}
              />
              <span className="min-w-0 text-sm text-text [overflow-wrap:anywhere]">
                {f.text}
                <span className="mt-1 block text-xs text-muted">
                  Source: {f.sourceRef} ({KIND_LABELS[f.sourceKind] ?? f.sourceKind})
                </span>
                <span className="mt-1 block border-l-2 border-line pl-2 text-xs italic text-text-soft">
                  {f.sourceQuote}
                </span>
                {f.sourceKind !== "resume" && (
                  <span className="mt-2 inline-block">
                    <FlagBadge>Interview only</FlagBadge>
                  </span>
                )}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {draft.restrictionsSuggested.length > 0 && (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-soft">
            Suggested restrictions
          </legend>
          <p className="text-xs text-muted">These are unchecked. Check one only if it is right.</p>
          {draft.restrictionsSuggested.map((r, i) => (
            <label key={i} className={rowClass}>
              <input
                type="checkbox"
                checked={restrictions.has(i)}
                onChange={() => setRestrictions((s) => toggle(s, i))}
                className={checkClass}
              />
              <span className="min-w-0 text-sm text-text [overflow-wrap:anywhere]">
                <span className="block text-xs text-muted">{RESTRICTION_LABELS[r.kind] ?? r.kind}</span>
                {r.value}
                <span className="mt-1 block text-xs text-muted">Source: your documents</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {error && (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {!empty && (
          <button type="button" onClick={save} disabled={pending || checkedCount === 0} className={primaryButton}>
            {pending ? "Saving" : "Save checked items"}
          </button>
        )}
        <button type="button" onClick={onClose} disabled={pending} className={quietButton}>
          {empty ? "Close" : "Discard"}
        </button>
      </div>
    </div>
  );
}
