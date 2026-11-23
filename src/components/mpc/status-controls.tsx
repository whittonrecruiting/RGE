"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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

  if (status === "draft") return <DraftControls mpcId={mpcId} />;
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

/** A draft cannot be paused, only completed or discarded. Discarding removes it, like Remove does for any MPC. */
function DraftControls({ mpcId }: { mpcId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function discard() {
    setError(null);
    start(async () => {
      const result = await setMpcStatus(mpcId, "removed");
      if (result.ok) router.push("/mpcs");
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-soft">
        Drafts are not marketed. This MPC becomes active as soon as its headline role and location are saved.
      </p>
      {confirming ? (
        <div className="flex flex-col gap-3 rounded border border-line bg-surface p-3">
          <p className="text-sm text-text">Discard this draft? It leaves your MPC list and is never marketed.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={pending} onClick={discard} className={dangerButton}>
              {pending ? "Discarding" : "Yes, discard"}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={quietButton}>
              Keep draft
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" onClick={() => setConfirming(true)} className={dangerButton}>
            Discard draft
          </button>
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
