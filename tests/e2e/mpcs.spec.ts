import { test, expect } from "@playwright/test";
import { FITS, overflowReport } from "./fit";

// Runs against /dev/mpcs, which renders the MPC screens with made-up data and no auth (404 in production).
for (const vp of [
  { w: 390, h: 844, name: "phone" },
  { w: 1440, h: 900, name: "desktop" },
]) {
  for (const view of ["", "detail", "readonly", "draft", "draft-readonly"]) {
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

test("a draft with no role shows as Untitled draft with an amber Draft badge", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/mpcs");
  const row = page.getByRole("row").filter({ hasText: "Untitled draft" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Draft", { exact: true })).toHaveClass(/text-flag/);
  await expect(row.getByText("Missing headline role, years of experience and pay target")).toBeVisible();
  await expect(page.getByRole("link", { name: "Draft", exact: true })).toBeVisible();
});

test("list rows show Pitch ready or Needs facts, and drafts show neither", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/mpcs");
  const ready = page.getByRole("row").filter({ hasText: "Scottsdale, AZ" });
  await expect(ready.getByText("Pitch ready", { exact: true })).toHaveClass(/text-ok/);
  const needs = page.getByRole("row").filter({ hasText: "Phoenix, AZ" });
  await expect(needs.getByText("Needs facts", { exact: true })).toHaveClass(/text-flag/);
  const draft = page.getByRole("row").filter({ hasText: "Untitled draft" });
  await expect(draft.getByText("Pitch ready", { exact: true })).toHaveCount(0);
  await expect(draft.getByText("Needs facts", { exact: true })).toHaveCount(0);
});

test("a draft page has the banner and marks the empty required field", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/mpcs?view=draft");
  await expect(page.getByRole("heading", { name: "Untitled draft" })).toBeVisible();
  await expect(page.getByText("This MPC is a draft. Add the headline role and location to activate it.")).toBeVisible();
  const role = page.getByLabel("Headline role");
  await expect(role).toHaveClass(/border-flag/);
  await expect(role).not.toHaveAttribute("required");
  await expect(page.getByLabel("Location")).not.toHaveClass(/border-flag/);
  await expect(page.getByText("Required to activate")).toHaveCount(1);
  await role.fill("Litigation Associate");
  await expect(page.getByText("Required to activate")).toHaveCount(0);
});

for (const vp of [
  { w: 390, h: 844, name: "phone" },
  { w: 1440, h: 900, name: "desktop" },
]) {
  test(`Discard draft asks to confirm and fits on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/dev/mpcs?view=draft");
    await page.getByRole("button", { name: "Discard draft" }).click();
    await expect(page.getByText("Discard this draft? It leaves your MPC list and is never marketed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Yes, discard" })).toBeVisible();
    expect(await overflowReport(page)).toEqual(FITS);
    await page.getByRole("button", { name: "Keep draft" }).click();
    await expect(page.getByRole("button", { name: "Discard draft" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Yes, discard" })).toHaveCount(0);
  });
}

test("a draft read-only view shows Not set for the missing role", async ({ page }) => {
  await page.goto("/dev/mpcs?view=draft-readonly");
  await expect(page.getByRole("heading", { name: "Untitled draft" })).toBeVisible();
  await expect(page.getByText("Not set").first()).toBeVisible();
});
