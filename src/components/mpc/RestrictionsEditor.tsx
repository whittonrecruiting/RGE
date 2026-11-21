"use client";

import { useState, useTransition } from "react";
import { setCredentials, setRestrictions, type CredentialInput, type RestrictionInput } from "@/lib/mpc/fact-actions";
import { dangerButton, fieldClass, primaryButton, quietButton } from "./ui";

const KIND_LABEL: Record<RestrictionInput["kind"], string> = {
  never_say: "Never say",
  confidential: "Confidential",
  excluded_company: "Excluded company",
  region_exclusion: "Excluded region",
};
const KINDS = Object.keys(KIND_LABEL) as RestrictionInput["kind"][];

type Props = { mpcId: string; restrictions: RestrictionInput[]; canEdit: boolean };

/** Never-say lines, confidential fields and excluded companies or regions. Drafting must honor all of them. */
export function RestrictionsEditor({ mpcId, restrictions, canEdit }: Props) {
  const [rows, setRows] = useState<RestrictionInput[]>(restrictions);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  if (!canEdit) {
    return restrictions.length === 0 ? (
      <p className="text-sm text-muted">No restrictions.</p>
    ) : (
      <ul className="flex min-w-0 flex-col divide-y divide-line rounded border border-line">
        {restrictions.map((r, i) => (
          <li key={i} className="flex min-w-0 flex-col gap-1 p-3 text-sm">
            <span className="text-xs text-muted">{KIND_LABEL[r.kind]}</span>
            <span className="text-text [overflow-wrap:anywhere]">{r.value}</span>
          </li>
        ))}
      </ul>
    );
  }

  const change = (i: number, patch: Partial<RestrictionInput>) => {
    setSaved(false);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await setRestrictions(mpcId, rows);
      if (!r.ok) setError(r.error);
      else setSaved(true);
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {rows.length === 0 && <p className="text-sm text-muted">No restrictions yet.</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-2 md:flex-row md:items-end">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted md:w-48">
            Type
            <select value={r.kind} onChange={(e) => change(i, { kind: e.target.value as RestrictionInput["kind"] })} className={fieldClass}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
            Value
            <input value={r.value} onChange={(e) => change(i, { value: e.target.value })} maxLength={200} className={fieldClass} />
          </label>
          <button
            type="button"
            onClick={() => {
              setSaved(false);
              setRows((rs) => rs.filter((_, j) => j !== i));
            }}
            className={dangerButton}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            setSaved(false);
            setRows((rs) => [...rs, { kind: "never_say", value: "" }]);
          }}
          className={quietButton}
        >
          Add restriction
        </button>
        <button type="button" disabled={pending} onClick={save} className={primaryButton}>
          Save restrictions
        </button>
      </div>
      {saved && <p className="text-sm text-ok">Saved.</p>}
      {error && (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
    </div>
  );
}

/** Licenses and admissions (for example a bar admission) with a region and a verified flag. */
export function CredentialsEditor({
  mpcId,
  credentials,
  canEdit,
}: {
  mpcId: string;
  credentials: CredentialInput[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<CredentialInput[]>(credentials);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  if (!canEdit) {
    return credentials.length === 0 ? (
      <p className="text-sm text-muted">No credentials.</p>
    ) : (
      <ul className="flex min-w-0 flex-col divide-y divide-line rounded border border-line">
        {credentials.map((c, i) => (
          <li key={i} className="min-w-0 p-3 text-sm text-text [overflow-wrap:anywhere]">
            {c.kind}, {c.region}
            {c.verified ? " (verified)" : " (not verified)"}
          </li>
        ))}
      </ul>
    );
  }

  const change = (i: number, patch: Partial<CredentialInput>) => {
    setSaved(false);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await setCredentials(mpcId, rows);
      if (!r.ok) setError(r.error);
      else setSaved(true);
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {rows.length === 0 && <p className="text-sm text-muted">No credentials yet.</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-2 md:flex-row md:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
            Credential
            <input value={r.kind} onChange={(e) => change(i, { kind: e.target.value })} maxLength={80} placeholder="Bar admission" className={fieldClass} />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
            Region
            <input value={r.region} onChange={(e) => change(i, { region: e.target.value })} maxLength={80} placeholder="Arizona" className={fieldClass} />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-text-soft">
            <input type="checkbox" checked={r.verified} onChange={(e) => change(i, { verified: e.target.checked })} />
            Verified
          </label>
          <button
            type="button"
            onClick={() => {
              setSaved(false);
              setRows((rs) => rs.filter((_, j) => j !== i));
            }}
            className={dangerButton}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            setSaved(false);
            setRows((rs) => [...rs, { kind: "", region: "", verified: false }]);
          }}
          className={quietButton}
        >
          Add credential
        </button>
        <button type="button" disabled={pending} onClick={save} className={primaryButton}>
          Save credentials
        </button>
      </div>
      {saved && <p className="text-sm text-ok">Saved.</p>}
      {error && (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
    </div>
  );
}
