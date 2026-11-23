import { test, expect } from "@playwright/test";
import { FITS, overflowReport } from "./fit";

// Runs against /dev/add-mpc (the sources-first Add MPC screen) and /dev/build-review (the step after
// Build profile, with a stand-in extraction), both with no auth.

const LONG_NAME = `jordan-example-resume-with-a-very-long-file-name-${"x".repeat(80)}.pdf`;

for (const vp of [
  { w: 390, h: 844, name: "phone" },
  { w: 1440, h: 900, name: "desktop" },
]) {
  test(`Add MPC fits and Build profile is visible on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/dev/add-mpc");
    await expect(page.getByRole("main")).toBeVisible();
    expect(await overflowReport(page)).toEqual(FITS);
    const build = page.getByRole("button", { name: "Build profile" });
    await expect(build).toBeVisible();
    await expect(build).toBeDisabled();
    await expect(page.getByRole("button", { name: "Or fill in the profile by hand" })).toBeVisible();

    // A file with a long name and a paste box must also fit.
    await page.getByLabel("Choose files").setInputFiles([
      { name: LONG_NAME, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
      { name: "call-notes.txt", mimeType: "text/plain", buffer: Buffer.from("Talked about Denver.") },
    ]);
    await page.getByRole("button", { name: "Paste text" }).click();
    expect(await overflowReport(page)).toEqual(FITS);
    await expect(build).toBeEnabled();
    const box = await build.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.w);
  });

  test(`the extraction failure after Build profile fits and offers a retry on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/dev/build-review?review=fail");
    await expect(
      page.getByText(
        "We saved this draft and its documents, but could not build the profile: You've hit the hourly limit for AI lookups. Try again later.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(await overflowReport(page)).toEqual(FITS);
  });
}

test("files get a kind by type and Paste text adds a notes box", async ({ page }) => {
  await page.goto("/dev/add-mpc");
  await page.getByLabel("Choose files").setInputFiles([
    { name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Notes.") },
  ]);
  const kinds = page.getByLabel("What is it");
  await expect(kinds).toHaveCount(2);
  await expect(kinds.nth(0)).toHaveValue("resume");
  await expect(kinds.nth(1)).toHaveValue("notes");

  await page.getByRole("button", { name: "Paste text" }).click();
  await expect(kinds).toHaveCount(3);
  await expect(kinds.nth(2)).toHaveValue("notes");
  const box = page.getByLabel("Pasted text", { exact: true });
  await expect(box).toBeVisible();
  await box.fill("Wants a hybrid role.");
  await expect(box).toHaveValue("Wants a hybrid role.");

  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(kinds).toHaveCount(2);
});

test("an open review survives a server re-render that no longer has ?review", async ({ page }) => {
  await page.goto("/dev/build-review?review=ok");
  const review = page.getByRole("heading", { name: "Review what was found" });
  await expect(review).toBeVisible();
  await expect(page.getByText("Server render: review=ok")).toBeVisible();
  // The query is gone, so a reload would not run the extraction again.
  await expect(page).toHaveURL(/\/dev\/build-review$/);
  // Any server action that revalidates the page re-renders it without ?review.
  await page.getByRole("button", { name: "Re-render without review" }).click();
  await expect(page.getByText("Server render: no review")).toBeVisible();
  await expect(review).toBeVisible();
  await expect(page.getByText("Led discovery on a $120M breach of contract matter")).toBeVisible();
});
