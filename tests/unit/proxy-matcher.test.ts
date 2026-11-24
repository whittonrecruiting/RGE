import { describe, expect, test } from "vitest";
import { config } from "@/proxy";

// Every page in the (app) group checks sign-in, which needs the proxy to have run. A request the
// matcher skips that still reaches an app page (a missing /apple-touch-icon.png lands on the
// [section] catch-all) used to fail with a 500 instead of a 404 or sign-in redirect.
const matched = (pathname: string) =>
  config.matcher.some((m) => new RegExp(`^${m}$`).test(pathname));

describe("proxy matcher", () => {
  test("runs on app pages, API routes and file-like paths that are not real assets", () => {
    for (const p of [
      "/",
      "/mpcs/new",
      "/campaign",
      "/api/webhooks/clerk",
      "/apple-touch-icon.png",
      "/index.html",
      "/config.js",
      "/favicon.ico",
      "/foo.svg",
    ]) {
      expect(matched(p), p).toBe(true);
    }
  });

  test("skips Next.js internals and the public brand assets", () => {
    for (const p of ["/_next/static/chunks/app.js", "/_next/image", "/brand/RGE-mark-64.png", "/brand/RGE-favicon.ico"]) {
      expect(matched(p), p).toBe(false);
    }
  });
});
