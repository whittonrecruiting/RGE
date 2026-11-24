import type { SyncNowResult } from "./actions";

export type SyncMessage = { tone: "ok" | "error"; text: string };

/** The message to show after a manual sync, from what the sync actually did. */
export function syncMessage(result: SyncNowResult): SyncMessage {
  if (!result.ok) return { tone: "error", text: result.error };
  const { status, error } = result.outcome;
  switch (status) {
    case "done":
      return { tone: "ok", text: "Sync finished." };
    case "more":
      return { tone: "ok", text: "Synced part of your history. RGE keeps going in the background." };
    case "needs_reconnect":
      return { tone: "error", text: "Reconnect needed. Gmail access was revoked." };
    default:
      return { tone: "error", text: error || "Sync failed. Try again." };
  }
}
