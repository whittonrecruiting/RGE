import { describe, expect, test } from "vitest";
import {
  domainMatches,
  domainOf,
  isFreemail,
  matchesDoNotContact,
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
  parseAddressList,
} from "@/lib/ledger/normalize";

describe("normalizeEmail", () => {
  test("handles case, spaces and display names", () => {
    expect(normalizeEmail("  Pat@Example.com ")).toBe("pat@example.com");
    expect(normalizeEmail("Pat Doe <Pat@Example.com>")).toBe("pat@example.com");
    expect(normalizeEmail('"Doe, Pat" <pat@example.com>')).toBe("pat@example.com");
    expect(normalizeEmail("<pat@example.com>")).toBe("pat@example.com");
  });
  test("returns null unless exactly one address", () => {
    expect(normalizeEmail("not an email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("a@example.com, b@example.org")).toBeNull();
    expect(normalizeEmail("A <a@example.com>, B <b@example.org>")).toBeNull();
    expect(normalizeEmail("pat@example")).toBeNull();
  });
});

describe("domains", () => {
  test("domainOf", () => {
    expect(domainOf("pat@example.com")).toBe("example.com");
  });
  test("normalizeDomain strips scheme, path, port and www", () => {
    expect(normalizeDomain("https://WWW.Example.com:8080/a/b?x=1")).toBe("example.com");
    expect(normalizeDomain("Example.org")).toBe("example.org");
    expect(normalizeDomain("localhost")).toBeNull();
  });
  test("domain match respects dot boundaries", () => {
    expect(domainMatches("firm-example.com", "firm-example.com")).toBe(true);
    expect(domainMatches("us.firm-example.com", "firm-example.com")).toBe(true);
    expect(domainMatches("notfirm-example.com", "firm-example.com")).toBe(false);
  });
  test("isFreemail", () => {
    expect(isFreemail("gmail.com")).toBe(true);
    expect(isFreemail("example.com")).toBe(false);
  });
});

describe("normalizeCompanyName", () => {
  test("drops punctuation, ampersands and suffixes", () => {
    const a = normalizeCompanyName("Smith & Jones, L.L.P.");
    expect(a).toBe("smith and jones");
    expect(normalizeCompanyName("smith and jones llp")).toBe(a);
    expect(normalizeCompanyName("Acme Co. Inc.")).toBe("acme");
  });
  test("hyphens, slashes and dots separate words", () => {
    expect(normalizeCompanyName("Smith-Jones LLP")).toBe(normalizeCompanyName("Smith Jones"));
    expect(normalizeCompanyName("Smith/Jones, LLP")).toBe("smith jones");
    expect(normalizeCompanyName("L.L.P.")).toBe("llp");
  });
});

describe("matchesDoNotContact", () => {
  const entry = {
    name: "Smith and Jones LLP",
    domains: ["smithjones-example.com"],
    aliases: ["Parent Holdings"],
  };
  test("matches by alias", () => {
    expect(matchesDoNotContact(entry, { name: "Parent Holdings Inc" })).toBe(true);
  });
  test("matches by subdomain", () => {
    expect(matchesDoNotContact(entry, { domain: "us.smithjones-example.com" })).toBe(true);
  });
  test("matches a hyphenated entry against the spaced name", () => {
    const hyphen = { name: "Smith-Jones", domains: [], aliases: [] };
    expect(matchesDoNotContact(hyphen, { name: "Smith Jones LLP" })).toBe(true);
  });
  test("does not match partial name overlap", () => {
    expect(matchesDoNotContact(entry, { name: "Jones" })).toBe(false);
  });
  test("empty target never matches", () => {
    expect(matchesDoNotContact(entry, { name: "  ", domain: null })).toBe(false);
    expect(matchesDoNotContact({ name: "", domains: [], aliases: [] }, { name: "" })).toBe(false);
  });
});

describe("parseAddressList", () => {
  test("handles quoted names with commas", () => {
    expect(parseAddressList('"Doe, Pat" <pat@example.com>, lee@example.org')).toEqual([
      { email: "pat@example.com", name: "Doe, Pat" },
      { email: "lee@example.org", name: null },
    ]);
  });
  test("skips invalid entries and empty input", () => {
    expect(parseAddressList("")).toEqual([]);
    expect(parseAddressList("junk, Lee <LEE@Example.net>")).toEqual([
      { email: "lee@example.net", name: "Lee" },
    ]);
  });
});
