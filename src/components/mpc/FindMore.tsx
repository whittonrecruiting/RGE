"use client";

import { useState, useTransition } from "react";
import { runFindMore, type FindMoreDraft } from "@/lib/mpc/find-more-action";
import { ExtractionReview } from "./ExtractionReview";
import { fieldClass, primaryButton, quietButton } from "./ui";

type Result = { draft: FindMoreDraft; issuedAt: number; signature: string };

/**
 * Searches public web pages for more sourced facts. The hints box helps the search find the right
 * person. Hints are sent to the AI model only: they are not saved and never reach a pitch.
 */
export function FindMore({ mpcId }: { mpcId: string }) {
  const [open, setOpen] = useState(false);
  const [hints, setHints] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [searching, startSearch] = useTransition();

  function search() {
    setError(null);
    setResult(null);
    startSearch(async () => {
      const r = await runFindMore(mpcId, hints);
      if (r.ok) setResult({ draft: r.draft, issuedAt: r.issuedAt, signature: r.signature });
      else setError(r.error);
    });
  }

  function close() {
    setResult(null);
    setOpen(false);
    setHints("");
    setError(null);
  }

  if (!open) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <div>
          <button type="button" onClick={() => setOpen(true)} className={quietButton}>
            Find more
          </button>
        </div>
        <p className="text-xs text-muted">Searches public web pages for sourced facts you can review.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h3 className="text-sm font-semibold text-text">Find more</h3>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
        Details that help find the right person, never used in pitches
        <textarea
          value={hints}
          onChange={(e) => setHints(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Current firm, bar number, publications"
          className={`${fieldClass} min-h-24 py-2`}
        />
      </label>
      <p className="text-xs text-muted">
        These details are sent to the AI model to find the right person. They are not saved.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={search} disabled={searching} className={primaryButton}>
          {searching ? "Searching" : "Search"}
        </button>
        <button type="button" onClick={close} disabled={searching} className={quietButton}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {result && (
        <ExtractionReview
          mpcId={mpcId}
          draft={result.draft}
          issuedAt={result.issuedAt}
          signature={result.signature}
          onClose={close}
        />
      )}
    </div>
  );
}
