"use client";

import { useState, useTransition } from "react";
import { dangerButton, primaryButton, quietButton } from "@/components/mpc/ui";
import { disconnectInbox, setPrimaryInbox, syncInboxNow } from "@/lib/inboxes/actions";
import { syncMessage } from "@/lib/inboxes/sync-message";

type Props = {
  inboxId: string;
  email: string;
  status: "connected" | "needs_reconnect" | "disconnected";
  isPrimary: boolean;
  isMine: boolean;
  oauthStart: string;
};

const FAILED = "That did not work. Try again.";

type Message = { tone: "ok" | "error"; text: string };

/** Per-inbox buttons. Failures show inline; a successful action revalidates the page on the server. */
export function InboxActions({ inboxId, email, status, isPrimary, isMine, oauthStart }: Props) {
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, start] = useTransition();

  const [running, setRunning] = useState<"sync" | "primary" | "disconnect" | null>(null);

  function run(which: "primary" | "disconnect", task: () => Promise<{ ok: boolean; error?: string }>) {
    setMessage(null);
    setRunning(which);
    start(async () => {
      try {
        const result = await task();
        if (!result.ok) setMessage({ tone: "error", text: result.error ?? FAILED });
      } catch {
        setMessage({ tone: "error", text: FAILED });
      } finally {
        setRunning(null);
      }
    });
  }

  function onSync() {
    setMessage(null);
    setRunning("sync");
    start(async () => {
      try {
        setMessage(syncMessage(await syncInboxNow(inboxId)));
      } catch {
        setMessage({ tone: "error", text: FAILED });
      } finally {
        setRunning(null);
      }
    });
  }

  function onDisconnect() {
    if (
      !window.confirm(
        `Disconnect ${email}? RGE stops reading and sending from it. Mail already imported stays in the history.`,
      )
    )
      return;
    run("disconnect", () => disconnectInbox(inboxId));
  }

  const live = status === "connected";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {live && (
          <button type="button" onClick={onSync} disabled={pending} className={quietButton}>
            {running === "sync" ? "Working" : "Sync now"}
          </button>
        )}
        {live && !isPrimary && (
          <button
            type="button"
            onClick={() => run("primary", () => setPrimaryInbox(inboxId))}
            disabled={pending}
            className={quietButton}
          >
            Make primary
          </button>
        )}
        {status === "needs_reconnect" && isMine && (
          <a href={oauthStart} className={`${primaryButton} inline-flex items-center`}>
            Reconnect
          </a>
        )}
        {status === "needs_reconnect" && !isMine && <span className="text-sm text-text-soft">Ask the owner to reconnect.</span>}
        {status !== "disconnected" && (
          <button type="button" onClick={onDisconnect} disabled={pending} className={dangerButton}>
            Disconnect
          </button>
        )}
      </div>

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`mt-1 text-sm ${message.tone === "error" ? "text-deny" : "text-ok"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
