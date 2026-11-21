"use client";

import { useState, useTransition } from "react";
import { pauseAllMpcs } from "@/lib/mpc/actions";
import { fieldClass, quietButton } from "./ui";

export function PauseAll({ canPauseAgency }: { canPauseAgency: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"mine" | "agency">("mine");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function onPause() {
    const what = scope === "agency" ? "every active MPC in the agency" : "all of your active MPCs";
    if (!window.confirm(`Pause ${what}?`)) return;
    setMessage(null);
    start(async () => {
      const result = await pauseAllMpcs(reason, scope);
      if (result.ok) {
        setMessage({ tone: "ok", text: result.count === 1 ? "Paused 1 MPC." : `Paused ${result.count} MPCs.` });
        setReason("");
      } else {
        setMessage({ tone: "error", text: result.error });
      }
    });
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setOpen(true)} className={quietButton}>
          Pause all
        </button>
        {message?.tone === "ok" && (
          <p role="status" className="text-sm text-ok">
            {message.text}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded border border-line bg-card p-4">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Reason (optional)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={fieldClass} />
      </label>
      {canPauseAgency && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          Whose MPCs
          <select value={scope} onChange={(e) => setScope(e.target.value as "mine" | "agency")} className={fieldClass}>
            <option value="mine">Mine only</option>
            <option value="agency">Whole agency</option>
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={pending} onClick={onPause} className={quietButton}>
          {pending ? "Pausing" : "Pause active MPCs"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={quietButton}>
          Close
        </button>
      </div>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm ${message.tone === "error" ? "text-deny" : "text-ok"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
