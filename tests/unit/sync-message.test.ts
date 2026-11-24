import { describe, expect, it } from "vitest";
import { syncMessage } from "@/lib/inboxes/sync-message";

const outcome = (status: "done" | "more" | "needs_reconnect" | "error", error?: string) => ({
  ok: true as const,
  outcome: { status, inserted: 0, error },
});

describe("syncMessage", () => {
  it("maps each outcome to its copy", () => {
    expect(syncMessage(outcome("done"))).toEqual({ tone: "ok", text: "Sync finished." });
    expect(syncMessage(outcome("more"))).toEqual({
      tone: "ok",
      text: "Synced part of your history. RGE keeps going in the background.",
    });
    expect(syncMessage(outcome("needs_reconnect"))).toEqual({
      tone: "error",
      text: "Reconnect needed. Gmail access was revoked.",
    });
  });
  it("shows the outcome error, or a default, for error", () => {
    expect(syncMessage(outcome("error", "Gmail is busy."))).toEqual({ tone: "error", text: "Gmail is busy." });
    expect(syncMessage(outcome("error"))).toEqual({ tone: "error", text: "Sync failed. Try again." });
  });
  it("passes through a failed action", () => {
    expect(syncMessage({ ok: false, error: "Inbox not found." })).toEqual({ tone: "error", text: "Inbox not found." });
  });
});
