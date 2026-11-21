"use client";

import { useState, useTransition } from "react";
import { setMpcStatus } from "@/lib/mpc/actions";
import type { MpcStatus } from "@/lib/mpc/schema";
import { dangerButton, fieldClass, primaryButton, quietButton } from "./ui";

export function StatusControls({ mpcId, status }: { mpcId: string; status: MpcStatus }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function change(next: "active" | "paused" | "removed") {
    if (next === "removed" && !window.confirm("Remove this MPC? It leaves the active list and is not marketed.")) return;
    setError(null);
    start(async () => {
      const result = await setMpcStatus(mpcId, next, next === "paused" ? reason : undefined);
      if (!result.ok) setError(result.error);
      else setReason("");
    });
  }

  if (status === "placed") {
    return <p className="text-sm text-text-soft">This MPC is placed. Its status cannot be changed here.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {status === "active" && (
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
            Reason for pausing (optional)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className={fieldClass}
            />
          </label>
          <button type="button" disabled={pending} onClick={() => change("paused")} className={quietButton}>
            Pause
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {status !== "active" && (
          <button type="button" disabled={pending} onClick={() => change("active")} className={primaryButton}>
            {status === "removed" ? "Restore" : "Resume"}
          </button>
        )}
        {status !== "removed" && (
          <button type="button" disabled={pending} onClick={() => change("removed")} className={dangerButton}>
            Remove
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
    </div>
  );
}
