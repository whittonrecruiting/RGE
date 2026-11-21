import { describe, expect, it } from "vitest";
import { parseTheme } from "@/lib/theme";

describe("parseTheme", () => {
  it("defaults to dark", () => {
    expect(parseTheme(undefined)).toBe("dark");
    expect(parseTheme("")).toBe("dark");
    expect(parseTheme("nonsense")).toBe("dark");
  });
  it("accepts light", () => {
    expect(parseTheme("light")).toBe("light");
  });
});
