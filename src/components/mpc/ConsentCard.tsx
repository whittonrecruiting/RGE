"use client";

import { useRef, useState, useTransition } from "react";
import { recordConsent } from "@/lib/mpc/consent-actions";
import { fieldClass, primaryButton, quietButton } from "./ui";

export type ConsentItem = {
  id: string;
  givenOn: string;
  method: "verbal" | "email" | "signed_form";
  recordedByName: string;
  hasProof: boolean;
};

const METHOD_LABEL: Record<ConsentItem["method"], string> = {
  verbal: "Verbal",
  email: "Email",
  signed_form: "Signed form",
};

/** Consent is a warning, never a block: outreach can run without it. */
export function ConsentCard({ mpcId, latest, canEdit }: { mpcId: string; latest: ConsentItem | null; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [givenOn, setGivenOn] = useState("");
  const [method, setMethod] = useState<ConsentItem["method"] | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function submit() {
    setError(null);
    const proofFile = fileRef.current?.files?.[0] ?? null;
    start(async () => {
      const r = await recordConsent(mpcId, { givenOn, method: method as ConsentItem["method"], proofFile });
      if (!r.ok) setError(r.error);
      else {
        setOpen(false);
        setGivenOn("");
        setMethod("");
      }
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {latest ? (
        <div className="flex min-w-0 flex-col gap-1 text-sm text-text [overflow-wrap:anywhere]">
          <span>
            Consent given on {latest.givenOn} ({METHOD_LABEL[latest.method].toLowerCase()}).
          </span>
          <span className="text-xs text-muted">
            Recorded by {latest.recordedByName}. {latest.hasProof ? "Proof file on record." : "No proof file."}
          </span>
        </div>
      ) : (
        <p className="rounded border border-flag p-3 text-sm text-flag">
          No consent on file. Outreach can still run; record consent to protect the agency.
        </p>
      )}
      {canEdit && !open && (
        <div>
          <button type="button" onClick={() => setOpen(true)} className={latest ? quietButton : primaryButton}>
            {latest ? "Record new consent" : "Record consent"}
          </button>
        </div>
      )}
      {canEdit && open && (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-3 md:flex-row">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
              Date consent was given
              <input type="date" value={givenOn} onChange={(e) => setGivenOn(e.target.value)} className={fieldClass} />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
              How it was given
              <select value={method} onChange={(e) => setMethod(e.target.value as ConsentItem["method"] | "")} className={fieldClass}>
                <option value="">Choose one</option>
                <option value="verbal">Verbal</option>
                <option value="email">Email</option>
                <option value="signed_form">Signed form</option>
              </select>
            </label>
          </div>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            Proof (optional, PDF, image or text, up to 10 MB)
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,application/pdf,image/*,text/*" className="min-w-0 text-sm text-text-soft" />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={pending} onClick={submit} className={primaryButton}>
              Save consent
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className={quietButton}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
    </div>
  );
}
