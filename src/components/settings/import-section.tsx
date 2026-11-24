"use client";

import { useRef, useState, useTransition } from "react";
import { Section } from "@/components/mpc/section";
import { fieldClass, primaryButton, quietButton } from "@/components/mpc/ui";
import { applyImport, previewImport, type ImportSummary } from "@/lib/history-import/actions";

const KINDS = [
  { value: "suppression", label: "Suppression list", hint: "A .csv with an email or recipient column and an optional reason, or a .txt with addresses on each line." },
  { value: "sends", label: "Send log", hint: "A .csv with the columns recipient, time, status, message_id and company." },
  { value: "followups", label: "Follow-up log", hint: "A .csv with the columns recipient, time, status and followup_message_id." },
  { value: "outcomes", label: "Sales outcomes", hint: "A .csv with the columns date, firm, contact and type." },
  { value: "dnc", label: "Do-not-contact list", hint: "A .csv with the columns name, domains, aliases and note." },
] as const;

const SHOWN_SKIPPED = 20;

type Shown = { mode: "preview" | "applied"; summary: ImportSummary };

function Alert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-deny [overflow-wrap:anywhere]">
      {message}
    </p>
  );
}

function Counts({ summary }: { summary: ImportSummary }) {
  const rows: [string, number][] = [
    ["Rows read", summary.rows],
    ["New events", summary.newEvents],
    ["New suppressions", summary.newSuppressions],
    ["Do-not-contact added", summary.dncAdded],
    ["Do-not-contact merged", summary.dncMerged],
    ["Rows skipped", summary.skipped.length],
  ];
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5 rounded border border-line px-3 py-2">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="text-sm font-semibold text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SkippedList({ skipped }: { skipped: ImportSummary["skipped"] }) {
  if (skipped.length === 0) return null;
  return (
    <div className="text-sm text-text-soft">
      <p>{skipped.length === 1 ? "1 row was skipped:" : `${skipped.length} rows were skipped:`}</p>
      <ul className="mt-1 list-disc pl-5 [overflow-wrap:anywhere]">
        {skipped.slice(0, SHOWN_SKIPPED).map((s) => (
          <li key={`${s.line}-${s.reason}`}>
            Line {s.line}: {s.reason}
          </li>
        ))}
      </ul>
      {skipped.length > SHOWN_SKIPPED && <p className="mt-1">and {skipped.length - SHOWN_SKIPPED} more.</p>}
    </div>
  );
}

/** Owners and admins upload old outreach files, see exact counts, then import. */
export function ImportSection({ initial }: { initial?: Shown } = {}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("sends");
  const [shown, setShown] = useState<Shown | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const current = KINDS.find((k) => k.value === kind)!;

  const reset = () => {
    setShown(null);
    setError(null);
  };

  function submit(mode: "preview" | "applied") {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    setError(null);
    start(async () => {
      const result = await (mode === "preview" ? previewImport(data) : applyImport(data));
      if (!result.ok) {
        setError(result.error);
        if (mode === "preview") setShown(null);
        return;
      }
      setShown({ mode, summary: result.summary });
    });
  }

  return (
    <div id="import-history" className="scroll-mt-20 md:scroll-mt-6">
      <Section title="Import history">
        <p className="text-sm text-text-soft">
          Bring in old send logs, follow-up logs, sales outcomes, suppression lists and do-not-contact lists so RGE
          never repeats a contact. Importing the same file again adds nothing new.
        </p>
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            submit("preview");
          }}
          className="flex min-w-0 flex-col gap-3 rounded border border-line bg-surface p-4"
        >
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
              Kind of file
              <select
                name="kind"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as typeof kind);
                  reset();
                }}
                className={fieldClass}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
              File
              <input
                name="file"
                type="file"
                accept={kind === "suppression" ? ".csv,.txt,text/csv,text/plain" : ".csv,text/csv"}
                required
                onChange={reset}
                className="min-h-11 min-w-0 max-w-full text-sm text-text-soft file:mr-3 file:min-h-11 file:rounded file:border file:border-line file:bg-card file:px-4 file:text-xs file:font-semibold file:uppercase file:tracking-[0.14em] file:text-text-soft"
              />
            </label>
          </div>
          <p className="text-sm text-text-soft [overflow-wrap:anywhere]">{current.hint}</p>
          <div>
            <button type="submit" disabled={pending} className={quietButton}>
              {pending ? "Working" : "Preview"}
            </button>
          </div>
        </form>

        <Alert message={error} />

        {shown && (
          <div className="flex min-w-0 flex-col gap-3 rounded border border-line bg-surface p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              {shown.mode === "preview" ? "Preview, nothing saved yet" : "Imported"}
            </p>
            <Counts summary={shown.summary} />
            <SkippedList skipped={shown.summary.skipped} />
            {shown.mode === "preview" && (
              <div>
                <button type="button" disabled={pending} onClick={() => submit("applied")} className={primaryButton}>
                  {pending ? "Importing" : "Import"}
                </button>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
