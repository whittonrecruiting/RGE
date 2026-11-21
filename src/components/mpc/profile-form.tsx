"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMpc, updateMpc } from "@/lib/mpc/actions";
import type { MpcInput } from "@/lib/mpc/schema";
import { fieldClass, primaryButton, quietButton } from "./ui";
import Link from "next/link";

export type ProfileValues = {
  headlineRole: string;
  location: string;
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
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-xs text-muted ${wide ? "md:col-span-2" : ""}`}>
      {label}
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

const text = (data: FormData, name: string) => String(data.get(name) ?? "");

export function ProfileForm({ mpcId, initial }: { mpcId?: string; initial?: ProfileValues }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
    setSaved(false);
    start(async () => {
      if (mpcId) {
        const result = await updateMpc(mpcId, input);
        if (result.ok) {
          setSaved(true);
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
        <Field label="Headline role" wide>
          <input
            name="headlineRole"
            required
            maxLength={120}
            defaultValue={v?.headlineRole ?? ""}
            className={fieldClass}
          />
        </Field>
        <Field label="Location">
          <input name="location" required maxLength={120} defaultValue={v?.location ?? ""} className={fieldClass} />
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
          Saved.
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
