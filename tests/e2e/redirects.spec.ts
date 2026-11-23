import { test, expect } from "@playwright/test";

// Old section links keep working after the navigation change.
const redirects: [string, string][] = [
  ["/team", "/settings#team"],
  ["/sent", "/campaign"],
  ["/opt-outs", "/campaign#opt-outs"],
  ["/dashboard", "/campaign"],
];

for (const [from, to] of redirects) {
  test(`${from} redirects permanently to ${to}`, async ({ request }) => {
    const res = await request.get(from, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    const location = res.headers()["location"];
    expect(new URL(location, "http://localhost").pathname + new URL(location, "http://localhost").hash).toBe(to);
  });
}
