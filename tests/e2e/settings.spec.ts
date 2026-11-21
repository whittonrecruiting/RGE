import { test, expect } from "@playwright/test";

// Runs against /dev/settings, which renders the settings page with made-up data and no auth (404 in production).
for (const vp of [
  { w: 390, h: 844, name: "phone" },
  { w: 1440, h: 900, name: "desktop" },
]) {
  test(`edit mode has no horizontal scroll and Save is reachable on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/dev/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    const save = page.getByRole("button", { name: "Save settings" });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test(`read-only mode has no horizontal scroll and no Save on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/dev/settings?view=readonly");
    await expect(page.getByText("Only the Owner and Admins can change settings.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
    await expect(page.getByLabel("Time zone")).toBeDisabled();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}

test("choosing Auto shows the warning and needs a confirm", async ({ page }) => {
  await page.goto("/dev/settings");
  await page.getByLabel("Approval mode").selectOption("auto");
  await expect(
    page.getByText("Emails will send without your review. You are responsible for every message sent from your account."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Emails will send without your review." }).last()).toBeVisible();
});
