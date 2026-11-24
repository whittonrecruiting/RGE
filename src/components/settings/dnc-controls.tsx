"use client";

import { useRef, useState, useTransition } from "react";
import { dangerButton, fieldClass, primaryButton, quietButton } from "@/components/mpc/ui";
import { addDncEntry, importDncCsv, removeDncEntry } from "@/lib/dnc/actions";
import type { CsvLineError } from "@/lib/dnc/csv";

const splitList = (raw: string) =>
  raw
    .split(/[,;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

function Alert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-deny [overflow-wrap:anywhere]">
      {message}
    </p>
  );
}

export function DncAddForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name") ?? "");
    setError(null);
    setDone(null);
    start(async () => {
      const result = await addDncEntry({
        name,
        domains: splitList(String(data.get("domains") ?? "")),
        aliases: splitList(String(data.get("aliases") ?? "")),
      });
      if (result.ok) {
        setDone(`${name.trim()} added.`);
        formRef.current?.reset();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex min-w-0 flex-col gap-3 rounded border border-line bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Add a company</p>
      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
          Company name
          <input name="name" required maxLength={200} autoComplete="off" className={fieldClass} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
          Domains (separate with commas)
          <input name="domains" autoComplete="off" placeholder="example.com, example.org" className={fieldClass} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
          Aliases: parents and subsidiaries (separate with commas)
          <input name="aliases" autoComplete="off" className={fieldClass} />
        </label>
      </div>
      <div>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Adding" : "Add company"}
        </button>
      </div>
      <Alert message={error} />
      {done && (
        <p role="status" className="text-sm text-ok [overflow-wrap:anywhere]">
          {done}
        </p>
      )}
    </form>
  );
}

export function DncRemoveButton({ id, name }: { id: string; name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onRemove() {
    if (
      !window.confirm(
        `Remove ${name} from the list? RGE may research and email this company again.`,
      )
    )
      return;
    setError(null);
    start(async () => {
      const result = await removeDncEntry(id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div>
      <button type="button" onClick={onRemove} disabled={pending} className={dangerButton} aria-label={`Remove ${name}`}>
        {pending ? "Removing" : "Remove"}
      </button>
      <Alert message={error} />
    </div>
  );
}

const SHOWN_ERRORS = 25;

export function DncUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<CsvLineError[]>([]);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    setSummary(null);
    setLineErrors([]);
    start(async () => {
      const result = await importDncCsv(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(`${result.added} added, ${result.merged} merged into existing companies.`);
      setLineErrors(result.errors);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex min-w-0 flex-col gap-3 rounded border border-line bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Upload CSV</p>
      <p className="text-sm text-text-soft">
        One company per row with the columns name, domains, aliases and note. Separate several domains or aliases with
        semicolons.
      </p>
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
        <input
          ref={inputRef}
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          aria-label="CSV file"
          className="min-h-11 min-w-0 max-w-full text-sm text-text-soft file:mr-3 file:min-h-11 file:rounded file:border file:border-line file:bg-card file:px-4 file:text-xs file:font-semibold file:uppercase file:tracking-[0.14em] file:text-text-soft"
        />
        <button type="submit" disabled={pending} className={quietButton}>
          {pending ? "Uploading" : "Upload CSV"}
        </button>
      </div>
      <Alert message={error} />
      {summary && (
        <p role="status" className="text-sm text-ok">
          {summary}
        </p>
      )}
      {lineErrors.length > 0 && (
        <div role="alert" className="text-sm text-deny">
          <p>{lineErrors.length === 1 ? "1 row was skipped:" : `${lineErrors.length} rows were skipped:`}</p>
          <ul className="mt-1 list-disc pl-5 [overflow-wrap:anywhere]">
            {lineErrors.slice(0, SHOWN_ERRORS).map((l) => (
              <li key={`${l.line}-${l.reason}`}>
                Line {l.line}: {l.reason}
              </li>
            ))}
          </ul>
          {lineErrors.length > SHOWN_ERRORS && <p className="mt-1">and {lineErrors.length - SHOWN_ERRORS} more.</p>}
        </div>
      )}
    </form>
  );
}
