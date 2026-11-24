import { describe, expect, test } from "vitest";
import { checkDomain, type TxtResolver } from "@/lib/inboxes/domain-check";

const notFound = (code: string) => Object.assign(new Error(`queryTxt ${code}`), { code });

function resolverFor(records: Record<string, string[][]>): TxtResolver {
  return async (name) => {
    const hit = records[name];
    if (!hit) throw notFound("ENODATA");
    return hit;
  };
}

const ALL = {
  "example.com": [["v=spf1 include:_spf.google.com ~all"], ["google-site-verification=abc"]],
  "google._domainkey.example.com": [["v=DKIM1; k=rsa; ", "p=MIIBIjANBg"]],
  "_dmarc.example.com": [["v=DMARC1; p=none"]],
};

describe("checkDomain", () => {
  test("all three present passes", async () => {
    const r = await checkDomain("example.com", resolverFor(ALL));
    expect(r.spf).toEqual({ ok: true, found: "v=spf1 include:_spf.google.com ~all", fix: null });
    expect(r.dkim.ok).toBe(true);
    expect(r.dkim.found).toBe("v=DKIM1; k=rsa; p=MIIBIjANBg");
    expect(r.dkim.fix).toBeNull();
    expect(r.dmarc).toEqual({ ok: true, found: "v=DMARC1; p=none", fix: null });
  });

  test("missing DKIM fails with fix text", async () => {
    const { ["google._domainkey.example.com"]: _drop, ...rest } = ALL;
    void _drop;
    const r = await checkDomain("example.com", resolverFor(rest));
    expect(r.spf.ok).toBe(true);
    expect(r.dmarc.ok).toBe(true);
    expect(r.dkim).toEqual({
      ok: false,
      found: null,
      fix: "Turn on DKIM signing in Google Admin (Apps > Google Workspace > Gmail > Authenticate email) and publish the record.",
    });
  });

  test("an SPF record without the Google include fails and reports what was found", async () => {
    const r = await checkDomain("example.com", resolverFor({ ...ALL, "example.com": [["v=spf1 include:other.example.net -all"]] }));
    expect(r.spf.ok).toBe(false);
    expect(r.spf.found).toBe("v=spf1 include:other.example.net -all");
    expect(r.spf.fix).toBe("Add `include:_spf.google.com` to your SPF record in your DNS provider.");
  });

  test("resolver ENOTFOUND counts as missing, not a crash", async () => {
    const r = await checkDomain("example.com", async () => {
      throw notFound("ENOTFOUND");
    });
    for (const c of [r.spf, r.dkim, r.dmarc]) {
      expect(c.ok).toBe(false);
      expect(c.found).toBeNull();
      expect(c.fix).toMatch(/\S/);
    }
  });
});
