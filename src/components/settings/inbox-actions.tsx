"use client";

import { useState, useTransition } from "react";
import { dangerButton, primaryButton, quietButton } from "@/components/mpc/ui";
import { disconnectInbox, setPrimaryInbox, syncInboxNow } from "@/lib/inboxes/actions";

type Props = {
  inboxId: string;
  email: string;
  status: "connected" | "needs_reconnect" | "disconnected";
  isPrimary: boolean;
  oauthStart: string;
};

type Message = { tone: "ok" | "error"; text: string };

/** Per-inbox buttons. Failures show inline; a successful action revalidates the page on the server. */
export function InboxActions({ inboxId, email, status, isPrimary, oauthStart }: Props) {
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, start] = useTransition();

  function run(task: () => Promise<{ ok: boolean; error?: string }>, okText: string | null) {
    setMessage(null);
    start(async () => {
      const result = await task();
      if (!result.ok)
        setMessage({
          tone: "error",
          text: result.error ?? "That did not work. Try again.",
        });
      else if (okText) setMessage({ tone: "ok", text: okText });
    });
  }

  const onSync = () =>
    run(async () => {
      const r = await syncInboxNow(inboxId);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }, "Sync finished.");

  function onDisconnect() {
    if (
      !window.confirm(
        `Disconnect ${email}? RGE stops reading and sending from it. Mail already imported stays in the history.`,
      )
    )
      return;
    run(() => disconnectInbox(inboxId), null);
  }

  const live = status === "connected";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {live && (
          <button type="button" onClick={onSync} disabled={pending} className={quietButton}>
            {pending ? "Working" : "Sync now"}
          </button>
        )}
        {live && !isPrimary && (
          <button
            type="button"
            onClick={() => run(() => setPrimaryInbox(inboxId), null)}
            disabled={pending}
            className={quietButton}
          >
            Make primary
          </button>
        )}
        {status === "needs_reconnect" && (
          <a href={oauthStart} className={`${primaryButton} inline-flex items-center`}>
            Reconnect
          </a>
        )}
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
