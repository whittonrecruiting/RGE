"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDocument, runExtraction } from "@/lib/mpc/document-actions";
import type { ProfileDraft } from "@/lib/ai/extract-profile";
import { ExtractionReview } from "./ExtractionReview";
import { fieldClass, primaryButton, quietButton } from "./ui";

export type DocumentItem = {
  id: string;
  kind: "resume" | "notes" | "transcript";
  filename: string;
  createdAt: string;
};

const KIND_LABEL: Record<DocumentItem["kind"], string> = {
  resume: "Resume",
  notes: "Notes",
  transcript: "Transcript",
};

/** The date as stored, in UTC, so server and browser render the same text. */
const day = (iso: string) => iso.slice(0, 10);

export function DocumentList({ documents }: { documents: DocumentItem[] }) {
  if (documents.length === 0) return <p className="text-sm text-muted">No documents yet.</p>;
  return (
    <ul className="flex min-w-0 flex-col divide-y divide-line rounded border border-line">
      {documents.map((d) => (
        <li key={d.id} className="flex min-w-0 flex-col gap-1 p-3 md:flex-row md:items-center md:justify-between">
          <span className="min-w-0 text-sm text-text [overflow-wrap:anywhere]">{d.filename}</span>
          <span className="text-xs text-muted">
            {KIND_LABEL[d.kind]} · {day(d.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Add a resume, notes or a transcript (file or pasted text), see what is on file, and run
 * extraction. Extraction only proposes: the review step decides what is saved.
 */
export function AddSources({ mpcId, documents }: { mpcId: string; documents: DocumentItem[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<DocumentItem["kind"]>("resume");
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ draft: ProfileDraft; issuedAt: number; signature: string } | null>(null);
  const [adding, startAdd] = useTransition();
  const [extracting, startExtract] = useTransition();

  function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    data.set("kind", kind);
    if (mode === "file") data.delete("pastedText");
    else data.delete("file");
    setError(null);
    setNotice(null);
    startAdd(async () => {
      const result = await addDocument(mpcId, data);
      if (result.ok) {
        formRef.current?.reset();
        setNotice("Added.");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function onExtract() {
    setError(null);
    setNotice(null);
    setDraft(null);
    startExtract(async () => {
      const result = await runExtraction(mpcId);
      if (result.ok) setDraft({ draft: result.draft, issuedAt: result.issuedAt, signature: result.signature });
      else setError(result.error);
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <form ref={formRef} onSubmit={onAdd} className="flex min-w-0 flex-col gap-4">
        <h3 className="text-sm font-semibold text-text">Add from resume, notes or transcript</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            What is it
            <select value={kind} onChange={(e) => setKind(e.target.value as DocumentItem["kind"])} className={fieldClass}>
              <option value="resume">Resume</option>
              <option value="notes">Notes</option>
              <option value="transcript">Transcript</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            How to add it
            <select value={mode} onChange={(e) => setMode(e.target.value as "file" | "paste")} className={fieldClass}>
              <option value="file">Upload a file</option>
              <option value="paste">Paste text</option>
            </select>
          </label>
        </div>
        {mode === "file" ? (
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            File (PDF, Word, text or Markdown, up to 10 MB)
            <input
              key="file"
              name="file"
              type="file"
              accept=".pdf,.docx,.txt,.md"
              required
              className={`${fieldClass} py-2.5`}
            />
          </label>
        ) : (
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            Text
            <textarea
              key="paste"
              name="pastedText"
              required
              rows={8}
              maxLength={200000}
              className={`${fieldClass} min-h-40 py-2`}
            />
          </label>
        )}
        <p className="text-xs text-muted">
          Documents are stored with this MPC. Extraction sends their text to the AI model but never asks it for contact
          details.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={adding} className={primaryButton}>
            {adding ? "Adding" : "Add document"}
          </button>
        </div>
      </form>

      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="text-sm font-semibold text-text">On file</h3>
        <DocumentList documents={documents} />
        <div>
          <button
            type="button"
            onClick={onExtract}
            disabled={extracting || documents.length === 0}
            className={quietButton}
          >
            {extracting ? "Reading documents" : "Run extraction"}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-ok">
          {notice}
        </p>
      )}
      {draft && <ExtractionReview
          mpcId={mpcId}
          draft={draft.draft}
          issuedAt={draft.issuedAt}
          signature={draft.signature}
          onClose={() => setDraft(null)} />}
    </div>
  );
}
