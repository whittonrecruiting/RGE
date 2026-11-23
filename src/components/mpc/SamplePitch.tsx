"use client";

import { useState, useTransition } from "react";
import type { SamplePitch as Pitch } from "@/lib/ai/sample-pitch";
import { clearSavedBullets, generateSamplePitch, saveBullets } from "@/lib/mpc/sample-pitch-action";
import { PitchReadyBadge } from "./badges";
import { dangerButton, primaryButton, quietButton } from "./ui";

export type SavedBulletItem = { position: number; factId: string; text: string };

type Props = {
  mpcId: string;
  canEdit: boolean;
  isDraft: boolean;
  pitchReady: boolean;
  /** Why the MPC is not pitch ready, shown under the badge. */
  reason: string | null;
  saved: SavedBulletItem[];
  /** Dev previews only: start with a rendered pitch. */
  initialPitch?: Pitch | null;
};

/**
 * An example pitch from the MPC's usable and confirmed facts, in the agency template, rendered on
 * white as a prospect would see it. Never sent. "Use these bullets" saves the three bullets for
 * real drafts later.
 */
export function SamplePitch({ mpcId, canEdit, isDraft, pitchReady, reason, saved, initialPitch = null }: Props) {
  const [pitch, setPitch] = useState<Pitch | null>(initialPitch);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(label: string, fn: () => Promise<void>) {
    setError(null);
    setNotice(null);
    setBusy(label);
    start(async () => {
      try {
        await fn();
      } finally {
        setBusy(null);
      }
    });
  }

  const generate = (swapPosition?: 1 | 2 | 3) =>
    run(swapPosition ? `swap${swapPosition}` : "generate", async () => {
      // A swap keeps the other bullets on screen; Regenerate starts from the saved bullets, if any.
      const r = await generateSamplePitch(mpcId, swapPosition ? { swapPosition, keep: pitch?.bullets } : {});
      if (r.ok) setPitch(r.pitch);
      else setError(r.error);
    });

  const save = () =>
    run("save", async () => {
      if (!pitch) return;
      const r = await saveBullets(mpcId, pitch.bullets);
      if (r.ok) setNotice("Saved. Real drafts will start from these bullets.");
      else setError(r.error);
    });

  const clear = () =>
    run("clear", async () => {
      const r = await clearSavedBullets(mpcId);
      if (r.ok) setNotice("Saved bullets cleared.");
      else setError(r.error);
    });

  if (isDraft) {
    return <p className="text-sm text-text-soft">Activate this MPC before previewing a pitch.</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <PitchReadyBadge ready={pitchReady} />
        {!pitchReady && reason && <span className="min-w-0 text-sm text-flag">{reason}</span>}
      </div>

      {saved.length > 0 && (
        <div className="flex min-w-0 flex-col gap-2 rounded border border-line p-3">
          <h3 className="text-sm font-semibold text-text">Saved bullets in use</h3>
          <ol className="flex min-w-0 list-decimal flex-col gap-1 pl-5 text-sm text-text-soft">
            {saved.map((b) => (
              <li key={b.position} className="[overflow-wrap:anywhere]">
                {b.text}
              </li>
            ))}
          </ol>
          {saved.length < 3 && (
            <p className="text-xs text-flag">A saved fact was edited or deleted. Preview a pitch to pick a replacement.</p>
          )}
          {canEdit && (
            <div>
              <button type="button" onClick={clear} disabled={pending} className={dangerButton}>
                {busy === "clear" ? "Clearing" : "Clear"}
              </button>
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2">
          <div>
            <button type="button" onClick={() => generate()} disabled={pending} className={primaryButton}>
              {busy === "generate" ? "Writing" : pitch ? "Regenerate" : "Preview a pitch"}
            </button>
          </div>
          <p className="text-xs text-muted">A preview only. It is never sent. Each preview counts as an AI lookup.</p>
        </div>
      )}
      {!canEdit && !pitch && <p className="text-sm text-muted">Only the owner, an Admin or the Owner can preview a pitch.</p>}

      {error && (
        <p role="alert" className="text-sm text-deny [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-ok">
          {notice}
        </p>
      )}

      {pitch && (
        <div className="flex min-w-0 flex-col gap-4">
          {pitch.warnings.length > 0 && (
            <ul className="flex flex-col gap-1">
              {pitch.warnings.map((w) => (
                <li key={w} className="text-sm text-flag [overflow-wrap:anywhere]">
                  {w}
                </li>
              ))}
            </ul>
          )}
          {/* The email as the recipient sees it: always on white, whatever the app theme. */}
          <div
            data-testid="sample-pitch-email"
            className="min-w-0 rounded border border-line bg-[#ffffff] p-4 text-sm text-[#1a1a1a] md:p-6"
          >
            <p className="[overflow-wrap:anywhere]">
              <span className="text-[#666666]">Subject: </span>
              {pitch.subject}
            </p>
            <div className="mt-4 whitespace-pre-wrap [overflow-wrap:anywhere]">{pitch.body}</div>
          </div>

          {canEdit && (
            <div className="flex min-w-0 flex-col gap-3">
              <ol className="flex min-w-0 flex-col divide-y divide-line rounded border border-line">
                {pitch.bullets.map((b, i) => {
                  const position = (i + 1) as 1 | 2 | 3;
                  return (
                    <li key={`${b.factId}-${i}`} className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-3">
                      <span className="min-w-0 flex-1 text-sm text-text-soft [overflow-wrap:anywhere]">
                        {position}. {b.text}
                      </span>
                      <button
                        type="button"
                        onClick={() => generate(position)}
                        disabled={pending}
                        className={quietButton}
                      >
                        {busy === `swap${position}` ? "Swapping" : `Swap bullet ${position}`}
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div>
                <button
                  type="button"
                  onClick={save}
                  disabled={pending || pitch.bullets.length !== 3}
                  className={primaryButton}
                >
                  {busy === "save" ? "Saving" : "Use these bullets"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
