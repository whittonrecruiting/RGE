"use client";

import { useRef, useState, useTransition } from "react";
import { fieldClass, primaryButton } from "@/components/mpc/ui";
import { addOptOut } from "@/lib/suppressions/actions";

/** Adds one address to the permanent list. The server action revalidates the page. */
export function AddOptOutForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setError(null);
    setDone(null);
    start(async () => {
      const result = await addOptOut(String(data.get("email") ?? ""), String(data.get("note") ?? ""));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(result.result === "added" ? "Added to the list." : "That address was already on the list.");
      formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex min-w-0 flex-col gap-3 rounded border border-line bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Add opt-out</p>
      <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
          Email address
          <input name="email" type="email" required autoComplete="off" className={fieldClass} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
          Note (optional)
          <input name="note" maxLength={500} autoComplete="off" className={fieldClass} />
        </label>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Adding" : "Add opt-out"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-deny [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-ok">
          {done}
        </p>
      )}
    </form>
  );
}
