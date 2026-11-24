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
    await page.goto("/dev/campaign?view=empty");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(SECTIONS);
    for (const copy of EMPTY_COPY) await expect(page.getByText(copy)).toBeVisible();
    await expect(page.getByRole("link", { name: "Connect an inbox" })).toHaveAttribute("href", "/settings#inboxes");
    expect(await overflowReport(page)).toEqual(FITS);
  });

  test(`opt-outs list fits on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/dev/campaign");
    await expect(page.locator("#opt-outs li").first()).toBeVisible();
    await expect(page.getByText("41 addresses")).toBeVisible();
    await expect(
      page.getByText("People on this list are never emailed again. It cannot be undone in RGE."),
    ).toBeVisible();
    expect(await overflowReport(page)).toEqual(FITS);
  });
}

test("health strip summarizes the inboxes", async ({ page }) => {
  await page.goto("/dev/campaign");
  const strip = page.getByRole("region", { name: "Campaign health" });
  await expect(strip.getByText("2 inboxes connected")).toBeVisible();
  await expect(strip.getByText("1 need reconnecting")).toBeVisible();
  await expect(strip.getByText("Importing mail history")).toBeVisible();
});

test("opt-outs show reasons and dates in the agency time zone", async ({ page }) => {
  await page.goto("/dev/campaign");
  const first = page.locator("#opt-outs li", { hasText: "sample.person.1@example.com" });
  await expect(first.getByText("Opted out")).toBeVisible();
  await expect(first.getByText("Nov 24, 2026")).toBeVisible();
  await expect(page.locator("#opt-outs li", { hasText: "sample.person.2@example.com" }).getByText("Bounced")).toBeVisible();
  await expect(page.locator("#opt-outs li", { hasText: "sample.person.3@example.com" }).getByText("Added by hand")).toBeVisible();
});

test("search filters the opt-out list", async ({ page }) => {
  await page.goto("/dev/campaign");
  await page.getByLabel("Search by email").fill("PERSON.17@");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=PERSON\.17%40/);
  await expect(page.locator("#opt-outs li")).toHaveCount(1);
  await expect(page.locator("#opt-outs li").first()).toContainText("sample.person.17@example.com");
  await expect(page.getByText('1 address matches "PERSON.17@"')).toBeVisible();
  await page.getByRole("link", { name: "Clear" }).click();
  await expect(page.getByText("41 addresses")).toBeVisible();
});
