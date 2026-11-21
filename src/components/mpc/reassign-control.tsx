"use client";

import { useState, useTransition } from "react";
import { reassignMpc } from "@/lib/mpc/actions";
import { fieldClass, primaryButton } from "./ui";

export function ReassignControl({
  mpcId,
  ownerUserId,
  members,
}: {
  mpcId: string;
  ownerUserId: string;
  members: { userId: string; name: string }[];
}) {
  // When the owner has been removed they are not in the list, so start with no selection.
  const [choice, setChoice] = useState(members.some((m) => m.userId === ownerUserId) ? ownerUserId : "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function onReassign() {
    setError(null);
    setDone(false);
    start(async () => {
      const result = await reassignMpc(mpcId, choice);
      if (result.ok) setDone(true);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
          New owner
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className={fieldClass}>
            <option value="" disabled>
              Choose a teammate
            </option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending || choice === "" || choice === ownerUserId}
          onClick={onReassign}
          className={primaryButton}
        >
          {pending ? "Reassigning" : "Reassign"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-ok">
          Reassigned.
        </p>
      )}
    </div>
  );
}
