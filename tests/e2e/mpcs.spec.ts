import { test, expect } from "@playwright/test";
import { FITS, overflowReport } from "./fit";

// Runs against /dev/mpcs, which renders the MPC screens with made-up data and no auth (404 in production).
for (const vp of [
  { w: 390, h: 844, name: "phone" },
  { w: 1440, h: 900, name: "desktop" },
]) {
  for (const view of ["", "detail", "readonly"]) {
    test(`MPC ${view || "list"} has no horizontal scroll with a 90 character headline on ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto(view ? `/dev/mpcs?view=${view}` : "/dev/mpcs");
      await expect(page.getByRole("main")).toBeVisible();
      expect(await overflowReport(page)).toEqual(FITS);
    });
  }
}

test("list shows cards on phone and a table on desktop, with amber badges", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/mpcs");
  await expect(page.getByRole("list").filter({ hasText: "Phoenix, AZ" })).toBeVisible();
  await expect(page.getByRole("table")).toBeHidden();
  await expect(page.getByText("No consent on file").first()).toBeVisible();
  await expect(page.getByText("3 facts to confirm").first()).toBeVisible();
  await expect(page.getByText("Owner removed").first()).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("table")).toBeVisible();
});

test("edit form is one column on phone and two on desktop", async ({ page }) => {
  await page.goto("/dev/mpcs?view=detail");
  const x = (name: string) => page.getByLabel(name).first().evaluate((el) => el.getBoundingClientRect().left);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await x("Location")).toBe(await x("Seniority"));
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await x("Location")).not.toBe(await x("Seniority"));
});
