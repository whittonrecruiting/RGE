import { test, expect } from "@playwright/test";
import { FITS, overflowReport } from "./fit";

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
    expect(await overflowReport(page)).toEqual(FITS);
  });

  test(`read-only mode has no horizontal scroll and no Save on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/dev/settings?view=readonly");
    await expect(page.getByText("Only the Owner and Admins can change settings.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
    await expect(page.getByLabel("Time zone")).toBeDisabled();
    expect(await overflowReport(page)).toEqual(FITS);
  });
}

test("choosing Auto shows the warning and needs a confirm", async ({ page }) => {
  await page.goto("/dev/settings");
  await page.getByLabel("Approval mode").selectOption("auto");
  await expect(
    page.getByText(
      "Emails will send without your review. You are responsible for every message sent from your account.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Emails will send without your review." }).last(),
  ).toBeVisible();
});

test("Inboxes then Team come first and the rest follow in order", async ({ page }) => {
  await page.goto("/dev/settings");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Inboxes",
    "Team",
    "Invite a teammate",
    "Agency",
    "Rules",
    "CRM",
    "Templates",
    "Approvals",
  ]);
  await expect(page.locator("#team")).toBeVisible();
});

test("read-only view lists the team without invite or member actions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/settings?view=readonly");
  await expect(page.locator("#team").getByRole("cell", { name: "Sample Admin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invite" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
});

for (const vp of [
  { w: 390, h: 844, name: "phone" },
  { w: 1440, h: 900, name: "desktop" },
]) {
  test(`inboxes section fits on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/dev/settings?inbox_error=teammate");
    await expect(page.locator("#inboxes")).toBeVisible();
    expect(await overflowReport(page)).toEqual(FITS);
  });
}

test("failing DKIM shows its fix text", async ({ page }) => {
  await page.goto("/dev/settings");
  const card = page.locator("#inboxes li", {
    hasText: "reconnect.needed@example.com",
  });
  await expect(
    card.getByText(
      "Turn on DKIM signing in Google Admin (Apps > Google Workspace > Gmail > Authenticate email) and publish the record.",
    ),
  ).toBeVisible();
  await expect(card.getByText("Reconnect needed")).toBeVisible();
});

test("reconnect needed shows a Reconnect link to the OAuth start", async ({ page }) => {
  await page.goto("/dev/settings");
  const card = page.locator("#inboxes li", {
    hasText: "reconnect.needed@example.com",
  });
  await expect(card.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", "/api/google/oauth/start");
  await expect(page.getByRole("link", { name: "Connect Gmail" })).toHaveAttribute("href", "/api/google/oauth/start");
});

test("healthy primary inbox and importing inbox show their status lines", async ({ page }) => {
  await page.goto("/dev/settings");
  const healthy = page.locator("#inboxes li", {
    hasText: "healthy.primary@example.com",
  });
  await expect(healthy.getByText("Primary", { exact: true })).toBeVisible();
  await expect(healthy.getByText("Connected", { exact: true })).toBeVisible();
  await expect(healthy.getByText(/History imported\. Last synced 9:05 AM\./)).toBeVisible();
  const importing = page.locator("#inboxes li", {
    hasText: "importing@example.com",
  });
  await expect(importing.getByText("Importing mail history since Nov 24, 2025")).toBeVisible();
});

test("inbox notices come from fixed copy only", async ({ page }) => {
  await page.goto("/dev/settings?inbox=connected");
  await expect(page.locator("#inboxes").getByRole("status").filter({ hasText: "Gmail connected." })).toBeVisible();

  await page.goto("/dev/settings?inbox_error=teammate");
  await expect(page.locator("#inboxes").getByRole("alert")).toHaveText(
    "This inbox is already connected by a teammate.",
  );

  await page.goto("/dev/settings?inbox_error=" + encodeURIComponent("<b>Evil raw text</b>"));
  await expect(page.locator("#inboxes").getByRole("alert")).toHaveText("Gmail could not be connected. Try again.");
  await expect(page.getByText("Evil raw text")).toHaveCount(0);
});

test("Inboxes is the first section", async ({ page }) => {
  await page.goto("/dev/settings");
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Inboxes");
});

test("Disconnect asks for confirmation and Cancel leaves the inbox alone", async ({ page }) => {
  await page.goto("/dev/settings");
  let asked = "";
  page.on("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  const card = page.locator("#inboxes li", {
    hasText: "importing@example.com",
  });
  await card.getByRole("button", { name: "Disconnect" }).click();
  expect(asked).toContain("Disconnect importing@example.com?");
  await expect(card).toBeVisible();
});
