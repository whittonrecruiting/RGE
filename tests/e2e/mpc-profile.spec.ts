import { test, expect } from "@playwright/test";
import { FITS, overflowReport } from "./fit";

// Runs against /dev/mpc-profile: 40 facts (all statuses and source kinds, long URL) and a 90 character restriction.

for (const vp of [
  { w: 390, h: 844, name: "phone" },
  { w: 1440, h: 900, name: "desktop" },
]) {
  test(`edit mode has no horizontal scroll and actions are visible on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/dev/mpc-profile?consent=none");
    await expect(page.getByRole("main")).toBeVisible();
    expect(await overflowReport(page)).toEqual(FITS);

    // Open the consent form too, then check the whole page again.
    await page.getByRole("button", { name: "Record consent" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Record consent" })).toBeVisible();
    await expect(page.getByText("No consent on file. Outreach can still run; record consent to protect the agency.")).toBeVisible();
    await page.getByRole("button", { name: "Record consent" }).click();
    await expect(page.getByRole("button", { name: "Save consent" })).toBeVisible();
    expect(await overflowReport(page)).toEqual(FITS);

    for (const name of ["Confirm", "Edit", "Delete", "Add fact", "Add restriction", "Save restrictions", "Add credential", "Save credentials"]) {
      const btn = page.getByRole("button", { name, exact: true }).first();
      await btn.scrollIntoViewIfNeeded();
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vp.w);
    }
    // Editing a fact opens a textarea that must also fit.
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    expect(await overflowReport(page)).toEqual(FITS);
  });

  test(`read-only mode has no horizontal scroll and no edit buttons on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/dev/mpc-profile?view=readonly");
    await expect(page.getByRole("main")).toBeVisible();
    expect(await overflowReport(page)).toEqual(FITS);
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Record consent" })).toHaveCount(0);
    await expect(page.getByText("To confirm (").first()).toBeVisible();
    await expect(page.getByText("Ready to use (").first()).toBeVisible();
  });
}

test("only https web sources are links", async ({ page }) => {
  await page.goto("/dev/mpc-profile");
  const hrefs = await page.locator("a[href^='http']").evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
  expect(hrefs.length).toBeGreaterThan(0);
  expect(hrefs.every((h) => h.startsWith("https://"))).toBe(true);
});

test("facts changed by hand are labelled", async ({ page }) => {
  await page.goto("/dev/mpc-profile");
  await expect(page.getByText("Source: Edited by hand").first()).toBeVisible();
  await expect(page.getByText("Source: Added by hand").first()).toBeVisible();
});
