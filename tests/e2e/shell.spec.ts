import { test, expect } from "@playwright/test";
import { FITS, overflowReport } from "./fit";

// Runs against /dev/shell, a route that renders AppShell without auth (404 in production).
for (const vp of [
  { w: 390, h: 844, name: "phone" },
  { w: 1440, h: 900, name: "desktop" },
]) {
  test(`shell renders on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/dev/shell");
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByRole("link", { name: "Approvals" })).toBeVisible();
    await expect(page.getByRole("link", { name: "MPCs" })).toBeVisible();
    expect(await overflowReport(page)).toEqual(FITS);
  });
}

test("body uses brand background", async ({ page }) => {
  await page.goto("/dev/shell");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(10, 10, 10)");
});

test("theme toggle switches to light and is remembered in a cookie", async ({ page }) => {
  await page.goto("/dev/shell");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("phone bottom bar has exactly five tabs and no Menu button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/shell");
  const bar = page.getByRole("navigation", { name: "Primary" }).last();
  await expect(bar.getByRole("link")).toHaveText(["Approvals", "MPCs", "Pipeline", "Campaign", "Settings"]);
  for (const link of await bar.getByRole("link").all()) await expect(link).toBeVisible();
  await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
  expect(await overflowReport(page)).toEqual(FITS);
});
