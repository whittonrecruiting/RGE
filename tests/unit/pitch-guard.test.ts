import { describe, expect, test } from "vitest";
import { checkBullet, numbersIn, strongFactsMessage } from "@/lib/mpc/pitch-guard";

const EM = String.fromCharCode(0x2014);
const FACT = "Led a $120M acquisition of a regional insurer in 2023";

describe("checkBullet", () => {
  test("a number not in the fact fails; the same figure passes in any common spelling", () => {
    expect(checkBullet("Led a $500M insurer acquisition", FACT)).toMatch(/not in its fact/);
    expect(checkBullet("Led a $120M insurer acquisition", FACT)).toBeNull();
    expect(checkBullet("Led a $120 million insurer acquisition", FACT)).toBeNull();
    expect(checkBullet("Led a $120,000,000 insurer acquisition", FACT)).toBeNull();
    expect(checkBullet("Closed a regional insurer deal in 2024", FACT)).toMatch(/not in its fact/);
  });

  test("an em dash fails", () => {
    expect(checkBullet(`Led a $120M acquisition ${EM} regional insurer`, FACT)).toMatch(/em dash/i);
  });

  test("bullets must be 3 to 12 words", () => {
    expect(checkBullet("Led acquisition", FACT)).toMatch(/3 to 12 words/);
    expect(checkBullet("Led the insurer acquisition", FACT)).toBeNull();
    expect(checkBullet("Led a regional insurer acquisition that the whole board then approved after review", FACT)).toMatch(
      /3 to 12 words/,
    );
  });

  test("pay, work authorization and placeholders fail", () => {
    expect(checkBullet("seeking $250K base", "Currently seeking $250K base pay")).toMatch(/pay/i);
    expect(checkBullet("Salary expectations are flexible here", "Salary expectations are flexible")).toMatch(/pay/i);
    expect(checkBullet("Needs H-1B visa sponsorship going forward", "Needs H-1B visa sponsorship")).toMatch(/work authorization/i);
    expect(checkBullet("[Candidate Name] led the insurer deal", FACT)).toMatch(/placeholder/i);
  });

  test("spelled numbers count as numbers", () => {
    expect(checkBullet("Tried three cases to verdict", "Tried two cases to verdict")).toMatch(/not in its fact/);
    expect(checkBullet("Tried two cases to verdict", "Tried 2 cases to verdict")).toBeNull();
  });

  test("links, bold and emojis fail", () => {
    expect(checkBullet("See https://example.test for the deal", FACT)).not.toBeNull();
    expect(checkBullet("Led the **insurer** acquisition", FACT)).not.toBeNull();
    expect(checkBullet(`Led the insurer acquisition ${String.fromCodePoint(0x1f680)}`, FACT)).not.toBeNull();
  });
});

describe("number guard: inflation the figure match alone would miss", () => {
  const ok = (bullet: string, fact: string) => expect(checkBullet(bullet, fact), `${bullet} | ${fact}`).toBeNull();
  const bad = (bullet: string, fact: string) => expect(checkBullet(bullet, fact), `${bullet} | ${fact}`).toMatch(/not in its fact/);

  test("existing normalizations still hold", () => {
    bad("Managed a $1.2B insurer portfolio", "Managed a $120M insurer portfolio");
    ok("Raised $120M for the fund", "Raised $120,000,000 for the fund");
    ok("Raised 120 million for the fund", "Raised $120M for the fund");
    ok("Raised $120M for the fund", "Raised $120M+ for the fund");
    bad("Raised $120M for the fund", "Raised 120M for the fund");
    ok("Tried two cases to verdict", "Tried 2 cases to verdict");
    ok("Tried 40 cases to verdict", "Tried 40+ cases to verdict");
  });

  test("a spelled number combines with a following scale word", () => {
    bad("Managed two billion in assets", "Managed two teams of associates");
    ok("Managed two billion in assets", "Managed $2B in assets");
    ok("Managed two billion in assets", "Managed two billion in client assets");
  });

  test("a scale word or magnitude adjective needs a figure at least that large or the same wording", () => {
    bad("Led a billion-dollar insurer portfolio", "Led a large insurer portfolio");
    ok("Led a billion-dollar insurer portfolio", "Led a $1.4B insurer portfolio");
    bad("Handled multimillion-dollar coverage matters", "Handled complex coverage matters");
    ok("Handled multimillion-dollar coverage matters", "Handled multimillion-dollar coverage matters for carriers");
    ok("Handled multimillion-dollar coverage matters", "Handled coverage matters worth $5M each");
    bad("Closed seven-figure settlements for carriers", "Closed $250,000 settlements for carriers");
    ok("Closed seven-figure settlements for carriers", "Closed $1.5M settlements for carriers");
    bad("Managed hundreds of coverage matters", "Managed 100 coverage matters");
    ok("Managed hundreds of coverage matters", "Managed 350 coverage matters");
    bad("Reviewed thousands of claim files", "Reviewed 900 claim files");
    bad("Trained dozens of junior associates", "Trained 12 junior associates");
    ok("Trained dozens of junior associates", "Trained dozens of junior associates firmwide");
    bad("Served millions of policyholders nationwide", "Served 1 million policyholders nationwide");
  });

  test("raising qualifiers need the same or a stronger qualifier in the fact", () => {
    bad("Tried 40+ cases to verdict", "Tried 40 cases to verdict");
    bad("Tried over 40 cases to verdict", "Tried 40 cases to verdict");
    bad("Tried more than 40 cases", "Tried 40 cases to verdict");
    bad("Tried nearly 50 cases to verdict", "Tried 45 cases to verdict");
    bad("Tried at least 40 cases", "Tried 40 cases to verdict");
    ok("Tried over 40 cases to verdict", "Tried more than 40 cases to verdict");
    ok("Tried 40+ cases to verdict", "Tried over 40 cases to verdict");
  });

  test("bare hundreds, thousands and dozens (no 'of') are magnitudes", () => {
    bad("Reviewed claims in the thousands", "Reviewed 900 claims");
    bad("Tried cases numbering in the hundreds", "Tried 150 cases to verdict");
    bad("Trained associates by the dozens", "Trained 12 associates");
    ok("Reviewed claims in the thousands", "Reviewed 4,500 claims");
    ok("Reviewed claims in the thousands", "Reviewed thousands of claims");
  });

  test("any N-figure is a magnitude of at least 10^(N-1), never the number N", () => {
    bad("Managed a ten-figure insurer portfolio", "Managed 10 associates and a $120M portfolio");
    ok("Managed a ten-figure insurer portfolio", "Managed a $1.4B insurer portfolio");
    bad("Closed 8-figure settlements for carriers", "Closed $2M settlements for 8 carriers");
    ok("Closed 8-figure settlements for carriers", "Closed $25M settlements for carriers");
  });

  test("bare thousand and chained spelled scales are numbers", () => {
    bad("Reviewed a thousand coverage claims", "Reviewed 900 coverage claims");
    ok("Reviewed a thousand coverage claims", "Reviewed 1,000 coverage claims");
    ok("Recovered one hundred million for clients", "Recovered $100M for clients");
    bad("Recovered one hundred million for clients", "Recovered $10M for clients");
  });

  test("a unitless number may drop a $ but not a %", () => {
    bad("Supervised 45 attorneys on claims", "Cut claim costs by 45%");
    ok("Raised 120M for the fund", "Raised $120M for the fund");
    ok("Raised $ 120M for the fund", "Raised $120M for the fund");
    bad("Raised $ 120M for the fund", "Raised 120M for the fund");
  });

  test("percent and currency are units", () => {
    bad("Cut claim costs by 45%", "Supervised 45 attorneys on claims");
    ok("Cut claim costs by 45%", "Cut claim costs by 45 percent");
    bad("Grew a $120M user platform", "Grew a platform to 120M users");
    ok("Recovered $120M for clients", "Recovered 120 million dollars for clients");
  });
});

describe("numbersIn", () => {
  test("normalizes figures to plain values", () => {
    expect(numbersIn("$120M and $1.2B and $250K and 45% and 1,200")).toEqual([120_000_000, 1_200_000_000, 250_000, 45, 1200]);
  });
});

describe("strongFactsMessage", () => {
  test("explains the shortfall", () => {
    expect(strongFactsMessage(2)).toBe("Only 2 strong facts. Confirm a note or run Find more.");
    expect(strongFactsMessage(1)).toBe("Only 1 strong fact. Confirm a note or run Find more.");
    expect(strongFactsMessage(0)).toBe("No strong facts yet. Confirm a note or run Find more.");
  });
});
