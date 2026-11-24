import { describe, expect, test } from "vitest";
import { isPublicPath } from "@/lib/public-paths";

describe("isPublicPath (proxy allow-list)", () => {
  test("sign-in, webhooks, manifest and brand assets are public", () => {
    for (const p of [
      "/sign-in",
      "/sign-in/factor-one",
      "/api/webhooks/clerk",
      "/manifest.webmanifest",
      "/brand/RGE-favicon.ico",
    ]) {
      expect(isPublicPath(p, "production"), p).toBe(true);
    }
  });

  test("/api/cron/gmail-sync is public to the proxy", () => {
    // The route checks CRON_SECRET itself; Clerk would otherwise block Vercel's cron call.
    expect(isPublicPath("/api/cron/gmail-sync", "production")).toBe(true);
    expect(isPublicPath("/api/cron", "production")).toBe(false);
    expect(isPublicPath("/api/cronx/gmail-sync", "production")).toBe(false);
  });

  test("everything else is protected", () => {
    for (const p of [
      "/",
      "/approvals",
      "/mpcs",
      "/no-agency",
      "/api/other",
      "/api/webhooks",
      "/sign-inx",
      "/brandx/a.png",
      "/manifest.webmanifest.evil",
    ]) {
      expect(isPublicPath(p, "production"), p).toBe(false);
    }
  });

  test("/dev/* is public only outside production", () => {
    expect(isPublicPath("/dev/shell", "development")).toBe(true);
    expect(isPublicPath("/dev/shell", "test")).toBe(true);
    expect(isPublicPath("/dev/shell", "production")).toBe(false);
    expect(isPublicPath("/devx", "development")).toBe(false);
  });
});
