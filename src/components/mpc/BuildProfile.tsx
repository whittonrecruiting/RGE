"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createDraftMpc } from "@/lib/mpc/actions";
import { buildProfile, type DocumentError } from "@/lib/mpc/build-profile-action";
import { MAX_SOURCES, MAX_TOTAL_BYTES, TOO_BIG_TOGETHER, TOO_MANY } from "@/lib/mpc/build-limits";
import { fieldClass, primaryButton, quietButton } from "./ui";

type Kind = "resume" | "notes" | "transcript";
type Item = { id: number; kind: Kind } & ({ file: File } | { paste: string });

const ACCEPT = ".pdf,.docx,.txt,.md";
/** PDF and Word files are usually resumes; anything else starts as notes. The recruiter can change it. */
const kindFor = (name: string): Kind => (/\.(pdf|docx)$/i.test(name) ? "resume" : "notes");

const linkButton = "text-sm text-text-soft underline underline-offset-4 hover:text-gold disabled:opacity-50";

/**
 * The Add MPC screen: drop or choose files, paste text, say what each one is, then Build profile.
 * That saves a draft MPC with the documents and opens it, where the profile is read from them.
 */
export function BuildProfile() {
  const router = useRouter();
  const nextId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [built, setBuilt] = useState<{ mpcId: string; documentErrors: DocumentError[] } | null>(null);
  const [pending, start] = useTransition();

  const newId = () => nextId.current++;

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const added = Array.from(files).map((file) => ({ id: newId(), kind: kindFor(file.name), file }));
    setItems((prev) => [...prev, ...added]);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const addPaste = () => {
    setItems((prev) => [...prev, { id: newId(), kind: "notes", paste: "" }]);
    setError(null);
  };
  const update = (id: number, patch: Partial<{ kind: Kind; paste: string }>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? ({ ...it, ...patch } as Item) : it)));
  const remove = (id: number) => setItems((prev) => prev.filter((it) => it.id !== id));

  const filled = items.filter((it) => ("file" in it ? true : it.paste.trim() !== ""));

  function onBuild() {
    setError(null);
    if (filled.length > MAX_SOURCES) return setError(TOO_MANY);
    const total = filled.reduce((sum, it) => sum + ("file" in it ? it.file.size : it.paste.length), 0);
    if (total > MAX_TOTAL_BYTES) return setError(TOO_BIG_TOGETHER);
    const data = new FormData();
    for (const it of filled) {
      if ("file" in it) data.append("file", it.file);
      else data.append("paste", it.paste);
      data.append("kind", it.kind);
    }
    start(async () => {
      const result = await buildProfile(data);
      if (!result.ok) return setError(result.error);
      // When some sources were refused, say which before moving on; otherwise go straight to the review.
      if (result.documentErrors.length > 0) setBuilt(result);
      else router.push(`/mpcs/${result.mpcId}?review=1`);
    });
  }

  function onByHand() {
    setError(null);
    start(async () => {
      const result = await createDraftMpc();
      if (result.ok) router.push(`/mpcs/${result.id}`);
      else setError(result.error);
    });
  }

  if (built) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <p role="status" className="text-sm text-text">
          We saved the draft, but these documents could not be added:
        </p>
        <ul className="flex min-w-0 flex-col divide-y divide-line rounded border border-line">
          {built.documentErrors.map((e, i) => (
            <li key={i} className="flex min-w-0 flex-col gap-1 p-3">
              <span className="text-sm text-text [overflow-wrap:anywhere]">{e.name}</span>
              <span className="text-xs text-deny">{e.error}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-text-soft">You can add them again on the profile page.</p>
        <div>
          <Link href={`/mpcs/${built.mpcId}?review=1`} className={`${primaryButton} inline-flex items-center`}>
            Continue to profile
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`flex min-w-0 cursor-pointer flex-col items-center gap-2 rounded border border-dashed p-6 text-center ${
          dragging ? "border-gold bg-hover" : "border-line bg-surface"
        }`}
      >
        <span className="text-sm font-semibold text-text">Drop resumes, notes or transcripts here</span>
        <span className="text-xs text-muted">or choose files. PDF, Word, text or Markdown, up to 10 MB each.</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          aria-label="Choose files"
          onChange={(e) => addFiles(e.target.files)}
          className="max-w-full text-xs text-text-soft file:mr-3 file:min-h-11 file:rounded file:border file:border-line file:bg-surface file:px-4 file:text-xs file:font-semibold file:uppercase file:tracking-[0.14em] file:text-text-soft"
        />
      </label>

      {items.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-3">
          {items.map((it) => (
            <li key={it.id} className="flex min-w-0 flex-col gap-3 rounded border border-line bg-surface p-3">
              <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-end">
                <span className="min-w-0 flex-1 text-sm text-text [overflow-wrap:anywhere]">
                  {"file" in it ? it.file.name : "Pasted text"}
                </span>
                <label className="flex min-w-0 flex-col gap-1 text-xs text-muted md:w-48">
                  What is it
                  <select
                    value={it.kind}
                    onChange={(e) => update(it.id, { kind: e.target.value as Kind })}
                    className={fieldClass}
                  >
                    <option value="resume">Resume</option>
                    <option value="notes">Notes</option>
                    <option value="transcript">Transcript</option>
                  </select>
                </label>
                <button type="button" onClick={() => remove(it.id)} className={quietButton}>
                  Remove
                </button>
              </div>
              {"paste" in it && (
                <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
                  Text
                  <textarea
                    aria-label="Pasted text"
                    value={it.paste}
                    onChange={(e) => update(it.id, { paste: e.target.value })}
                    rows={6}
                    maxLength={200000}
                    className={`${fieldClass} min-h-32 py-2`}
                  />
                </label>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted">
        Documents are stored with this MPC. Building the profile sends their text to the AI model but never asks it for
        contact details. You review everything before it is saved to the profile.
      </p>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onBuild} disabled={pending || filled.length === 0} className={primaryButton}>
          {pending ? "Saving documents" : "Build profile"}
        </button>
        <button type="button" onClick={addPaste} disabled={pending} className={quietButton}>
          Paste text
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}

      <div>
        <button type="button" onClick={onByHand} disabled={pending} className={linkButton}>
          Or fill in the profile by hand
        </button>
      </div>
    </div>
  );
}
