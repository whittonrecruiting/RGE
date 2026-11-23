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
