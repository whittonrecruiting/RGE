"use client";

import { useState, useTransition } from "react";
import { addManualFact, confirmFact, deleteFact, updateFact } from "@/lib/mpc/fact-actions";
import { fieldClass, dangerButton, primaryButton, quietButton } from "./ui";

export type FactItem = {
  id: string;
  text: string;
  sourceKind: "resume" | "notes" | "transcript" | "web" | "manual";
  sourceRef: string | null;
  status: "usable" | "interview_only" | "confirmed";
  /** The wording was changed by hand. */
  edited?: boolean;
};

const KIND_LABEL: Record<FactItem["sourceKind"], string> = {
  resume: "Resume",
  notes: "Notes",
  transcript: "Transcript",
  web: "Web",
  manual: "Added by hand",
};

const isHttps = (v: string | null): v is string => {
  if (!v) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

function Source({ fact }: { fact: FactItem }) {
  if (fact.sourceKind === "manual") return <span>Source: {fact.edited ? "Edited by hand" : "Added by hand"}</span>;
  if (fact.sourceKind === "web") {
    return isHttps(fact.sourceRef) ? (
      <span className="min-w-0 [overflow-wrap:anywhere]">
        Source:{" "}
        <a href={fact.sourceRef} target="_blank" rel="noopener noreferrer" className="text-gold underline">
          {fact.sourceRef}
        </a>
      </span>
    ) : (
      <span className="min-w-0 [overflow-wrap:anywhere]">Source: {fact.sourceRef ?? "Web"}</span>
    );
  }
  return <span className="min-w-0 [overflow-wrap:anywhere]">Source: {fact.sourceRef ?? KIND_LABEL[fact.sourceKind]}</span>;
}

function FactRow({ fact, canEdit }: { fact: FactItem; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.text);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: () => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else done?.();
    });
  }

  return (
    <li className="flex min-w-0 flex-col gap-2 p-3">
      {editing ? (
        <div className="flex min-w-0 flex-col gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            Fact
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
              rows={3}
              className={`${fieldClass} py-2`}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => updateFact(fact.id, text), () => setEditing(false))}
              className={primaryButton}
            >
              Save
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setText(fact.text);
                setError(null);
              }}
              className={quietButton}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <span className="text-sm text-text [overflow-wrap:anywhere]">{fact.text}</span>
      )}
      <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted">
        <Source fact={fact} />
        {fact.edited && fact.sourceKind !== "manual" && <span>Edited by hand</span>}
        {fact.status === "confirmed" && <span>Confirmed</span>}
      </span>
      {canEdit && !editing && (
        <div className="flex flex-wrap gap-2">
          {fact.status === "interview_only" && (
            <button type="button" disabled={pending} onClick={() => run(() => confirmFact(fact.id))} className={primaryButton}>
              Confirm
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => setEditing(true)} className={quietButton}>
            Edit
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Delete this fact?")) run(() => deleteFact(fact.id));
            }}
            className={dangerButton}
          >
            Delete
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
    </li>
  );
}

function Group({ title, note, tone, facts, canEdit }: { title: string; note?: string; tone: string; facts: FactItem[]; canEdit: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className={`text-xs font-semibold uppercase tracking-[0.14em] ${tone}`}>
          {title} ({facts.length})
        </h3>
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
      {facts.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul className={`flex min-w-0 flex-col divide-y divide-line rounded border ${tone === "text-flag" ? "border-flag" : "border-line"}`}>
          {facts.map((f) => (
            <FactRow key={`${f.id}:${f.text}:${f.status}`} fact={f} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddFact({ mpcId }: { mpcId: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add() {
    setError(null);
    start(async () => {
      const r = await addManualFact(mpcId, text);
      if (!r.ok) setError(r.error);
      else setText("");
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
        Add a fact you know to be true
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={300} rows={2} className={`${fieldClass} py-2`} />
      </label>
      <div>
        <button type="button" disabled={pending || text.trim() === ""} onClick={add} className={quietButton}>
          Add fact
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
    </div>
  );
}

/** Facts in two groups: ready to use in pitches, and interview-only facts waiting for a recruiter to confirm. */
export function FactList({ mpcId, facts, canEdit }: { mpcId: string; facts: FactItem[]; canEdit: boolean }) {
  const ready = facts.filter((f) => f.status !== "interview_only");
  const toConfirm = facts.filter((f) => f.status === "interview_only");
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {facts.length === 0 && (
        <p className="text-sm text-muted">
          No facts yet.{canEdit ? " Add a resume, notes or a transcript below and run extraction, or add one by hand." : ""}
        </p>
      )}
      {facts.length > 0 && (
        <>
          <Group title="Ready to use" tone="text-text" facts={ready} canEdit={canEdit} />
          <Group
            title="To confirm"
            note="Interview only. These stay out of emails until you confirm them."
            tone="text-flag"
            facts={toConfirm}
            canEdit={canEdit}
          />
        </>
      )}
      {canEdit && <AddFact mpcId={mpcId} />}
    </div>
  );
}
