import { test, expect } from "@playwright/test";
import { FITS, overflowReport } from "./fit";

// Runs against /dev/campaign, which renders the Campaign page with no auth (404 in production).
const SECTIONS = ["Performance", "Activity", "Opt-outs and bounces", "Errors"];
const EMPTY_COPY = [
  "Research and sending start once inboxes are connected.",
  "Pitch, follow-up and reply numbers appear here once outreach starts.",
  "Every pitch and follow-up RGE sends will be listed here with its status.",
  "People who opt out or bounce are listed here and never emailed again.",
  "Anything that fails to send or research will show here with the reason.",
];

for (const vp of [
  { w: 390, h: 844, name: "phone" },
  { w: 1440, h: 900, name: "desktop" },
]) {
  test(`campaign shows its sections in order with empty states on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/dev/campaign");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(SECTIONS);
    for (const copy of EMPTY_COPY) await expect(page.getByText(copy)).toBeVisible();
    expect(await overflowReport(page)).toEqual(FITS);
  });
}
