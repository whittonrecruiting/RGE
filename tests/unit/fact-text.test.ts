import { describe, expect, test } from "vitest";
import { cleanFactText } from "@/lib/mpc/fact-text";

const EM = String.fromCharCode(0x2014);

describe("cleanFactText", () => {
  test("trims and accepts 1 to 300 characters", () => {
    expect(cleanFactText("  Speaks Spanish  ")).toEqual({ ok: true, text: "Speaks Spanish" });
    expect(cleanFactText("a".repeat(300))).toEqual({ ok: true, text: "a".repeat(300) });
    expect(cleanFactText(` ${"a".repeat(300)} `)).toEqual({ ok: true, text: "a".repeat(300) });
  });
  test("rejects empty, non-string, too long and em dash text", () => {
    expect(cleanFactText("   ")).toEqual({ ok: false, error: "Enter the fact." });
    expect(cleanFactText(undefined)).toEqual({ ok: false, error: "Enter the fact." });
    expect(cleanFactText(42)).toEqual({ ok: false, error: "Enter the fact." });
    expect(cleanFactText("a".repeat(301))).toEqual({ ok: false, error: "Keep the fact to 300 characters or fewer." });
    expect(cleanFactText(`Great ${EM} truly`)).toEqual({ ok: false, error: "Remove em dashes from this fact." });
  });
});
