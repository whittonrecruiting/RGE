"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { runExtraction, type ExtractionResult } from "@/lib/mpc/document-actions";
import type { ProfileDraft } from "@/lib/ai/extract-profile";
import { ExtractionReview } from "./ExtractionReview";
import { quietButton } from "./ui";

type Draft = { draft: ProfileDraft; issuedAt: number; signature: string };

/**
 * Shown after Build profile (?review=1): reads the saved documents once and opens the review at the
 * top of the page. The query is dropped from the address first, so a reload does not run (and pay
 * for) the extraction again. If it fails, the draft and documents are already saved; say so and
 * offer to try again.
 */
export function BuildReview({
  mpcId,
  extract = runExtraction,
}: {
  mpcId: string;
  /** Dev layout checks pass a stand-in; the app always uses runExtraction. */
  extract?: (mpcId: string) => Promise<ExtractionResult>;
}) {
  const started = useRef(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      try {
        const result = await extract(mpcId);
        if (result.ok) setDraft({ draft: result.draft, issuedAt: result.issuedAt, signature: result.signature });
        else setError(result.error);
      } catch {
        setError("The extraction did not finish. Try again.");
      }
    });
  }

  useEffect(() => {
    // Once per page load, even when React runs effects twice in development.
    if (started.current) return;
    started.current = true;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (done) return null;
  if (draft) {
    return (
      <ExtractionReview
        mpcId={mpcId}
        draft={draft.draft}
        issuedAt={draft.issuedAt}
        signature={draft.signature}
        onClose={() => {
          setDraft(null);
          setDone(true);
        }}
      />
    );
  }
  if (error) {
    return (
      <div className="flex min-w-0 flex-col gap-3 rounded border border-flag bg-card p-4">
        <p role="alert" className="text-sm text-text [overflow-wrap:anywhere]">
          We saved this draft and its documents, but could not build the profile: {error}
        </p>
        <div>
          <button type="button" onClick={run} disabled={pending} className={quietButton}>
            {pending ? "Reading documents" : "Try again"}
          </button>
        </div>
      </div>
    );
  }
  return (
    <p role="status" className="rounded border border-line bg-card p-4 text-sm text-text-soft">
      Reading the documents to build the profile.
    </p>
  );
}
