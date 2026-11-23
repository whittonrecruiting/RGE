"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMpc, updateMpc } from "@/lib/mpc/actions";
import type { MpcInput } from "@/lib/mpc/schema";
import { fieldClass, primaryButton, quietButton } from "./ui";
import Link from "next/link";

export type ProfileValues = {
  /** Null only while the MPC is a draft. */
  headlineRole: string | null;
  location: string | null;
  yearsExperience: number | null;
  seniority: string | null;
  specialtyTags: string[];
  workMode: "onsite" | "hybrid" | "remote" | "any";
  employerType: "inhouse" | "firm" | "either";
  targetCities: string[];
  payFloor: number | null;
  payFloorStrict: boolean;
  payTarget: number | null;
  overlapPriority: number;
};

function Field({
  label,
  hint,
  children,
  wide,
  warn,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  wide?: boolean;
  /** Show the hint in amber. */
  warn?: boolean;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-xs text-muted ${wide ? "md:col-span-2" : ""}`}>
      {label}
      {children}
      {hint && <span className={`text-xs ${warn ? "text-flag" : "text-muted"}`}>{hint}</span>}
    </label>
  );
}

const text = (data: FormData, name: string) => String(data.get(name) ?? "");

const REQUIRED_TO_ACTIVATE = "Required to activate";
/** Amber outline on a required field a draft has not filled yet. */
const draftGapClass = fieldClass.replace("border-line", "border-flag");

/**
 * draft: the MPC is a draft. Headline role and location may stay blank; while blank they are
 * outlined in amber. Saving with both set activates the MPC.
 */
export function ProfileForm({ mpcId, initial, draft = false }: { mpcId?: string; initial?: ProfileValues; draft?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [role, setRole] = useState(initial?.headlineRole ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const gap = (value: string) => draft && value.trim() === "";
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const input = {
      headlineRole: text(data, "headlineRole"),
      location: text(data, "location"),
      yearsExperience: text(data, "yearsExperience"),
      seniority: text(data, "seniority"),
      specialtyTags: text(data, "specialtyTags"),
      workMode: text(data, "workMode"),
      employerType: text(data, "employerType"),
      targetCities: text(data, "targetCities"),
      payFloor: text(data, "payFloor"),
      payFloorStrict: data.get("payFloorStrict") === "on",
      payTarget: text(data, "payTarget"),
      overlapPriority: text(data, "overlapPriority"),
    } as MpcInput;
    setError(null);
    setSaved(null);
    start(async () => {
      if (mpcId) {
        const result = await updateMpc(mpcId, input);
        if (result.ok) {
          setSaved(result.activated ? "Saved. This MPC is now active." : "Saved.");
          router.refresh();
        } else {
          setError(result.error);
        }
      } else {
        const result = await createMpc(input);
        if (result.ok) router.push(`/mpcs/${result.id}`);
        else setError(result.error);
      }
    });
  }

  const v = initial;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Headline role" hint={gap(role) ? REQUIRED_TO_ACTIVATE : undefined} warn wide>
          <input
            name="headlineRole"
            required={!draft}
            maxLength={120}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={gap(role) ? draftGapClass : fieldClass}
          />
        </Field>
        <Field label="Location" hint={gap(location) ? REQUIRED_TO_ACTIVATE : undefined} warn>
          <input
            name="location"
            required={!draft}
            maxLength={120}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={gap(location) ? draftGapClass : fieldClass}
          />
        </Field>
        <Field label="Seniority">
          <input name="seniority" maxLength={120} defaultValue={v?.seniority ?? ""} className={fieldClass} />
        </Field>
        <Field label="Years of experience">
          <input
            name="yearsExperience"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            defaultValue={v?.yearsExperience ?? ""}
            className={fieldClass}
          />
        </Field>
        <Field label="Overlap priority" hint="Higher numbers win when two MPCs fit the same prospect.">
          <input
            name="overlapPriority"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            defaultValue={v?.overlapPriority ?? 0}
            className={fieldClass}
          />
        </Field>
        <Field label="Work mode">
          <select name="workMode" defaultValue={v?.workMode ?? "any"} className={fieldClass}>
            <option value="any">Any</option>
            <option value="onsite">On site</option>
            <option value="hybrid">Hybrid</option>
            <option value="remote">Remote</option>
          </select>
        </Field>
        <Field label="Employer type">
          <select name="employerType" defaultValue={v?.employerType ?? "either"} className={fieldClass}>
            <option value="either">Either</option>
            <option value="inhouse">In house</option>
            <option value="firm">Firm</option>
          </select>
        </Field>
        <Field label="Specialty tags" hint="Separate with commas." wide>
          <input name="specialtyTags" defaultValue={(v?.specialtyTags ?? []).join(", ")} className={fieldClass} />
        </Field>
        <Field label="Target cities" hint="Separate with commas." wide>
          <input name="targetCities" defaultValue={(v?.targetCities ?? []).join(", ")} className={fieldClass} />
        </Field>
        <Field label="Pay floor (whole dollars)">
          <input
            name="payFloor"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            defaultValue={v?.payFloor ?? ""}
            className={fieldClass}
          />
        </Field>
        <Field label="Pay target (whole dollars)">
          <input
            name="payTarget"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            defaultValue={v?.payTarget ?? ""}
            className={fieldClass}
          />
        </Field>
        <label className="flex min-h-11 items-center gap-3 text-sm text-text-soft md:col-span-2">
          <input
            name="payFloorStrict"
            type="checkbox"
            defaultChecked={v?.payFloorStrict ?? false}
            className="size-5 accent-[var(--c-gold)]"
          />
          The pay floor is firm
        </label>
      </div>
      <p className="text-xs text-muted">Compensation is for matching only. It never appears in a pitch.</p>

      {error && (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-ok">
          {saved}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving" : mpcId ? "Save changes" : "Add MPC"}
        </button>
        {!mpcId && (
          <Link href="/mpcs" className={`${quietButton} inline-flex items-center`}>
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}
