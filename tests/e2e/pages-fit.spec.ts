import { test, expect } from "@playwright/test";
import { FITS, overflowReport } from "./fit";

// Signed-in layout check of the real pages. It needs a seeded test owner, a Clerk testing token and an
// MPC with 40 facts and a 90 character firm name restriction, so it runs in the deploy task, not locally.
// Set E2E_CLERK_TESTING=1 (plus E2E_MPC_ID for the seeded MPC) to run it.
const enabled = Boolean(process.env.E2E_CLERK_TESTING);

const viewports = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];

const pages: { path: string; primary: string }[] = [
  { path: "/mpcs", primary: "Add MPC" },
  { path: `/mpcs/${process.env.E2E_MPC_ID ?? "seeded"}`, primary: "Save changes" },
  { path: "/team", primary: "Send invite" },
  { path: "/settings", primary: "Save settings" },
];

for (const vp of viewports) {
  for (const { path, primary } of pages) {
    test(`${path} fits at ${vp.width}x${vp.height}`, async ({ page }) => {
      test.skip(!enabled, "Needs Clerk testing credentials (E2E_CLERK_TESTING); runs in the deploy task.");
      await page.setViewportSize(vp);
      await page.goto(path);
      const button = page.getByRole("button", { name: primary }).or(page.getByRole("link", { name: primary })).first();
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeVisible();
      expect(await overflowReport(page)).toEqual(FITS);
    });
  }
}
