import { describe, expect, test } from "vitest";
import { findMore } from "@/lib/ai/find-more";
import { fakeGenerate } from "../helpers/fake-ai";

const sampleMpc = {
  headlineRole: "Senior Litigation Associate",
  location: "Phoenix, AZ",
  specialtyTags: ["insurance coverage"],
  facts: ["Led discovery on a large matter"],
};
const Q = "Published an article on first-party coverage disputes";

describe("findMore", () => {
  test("drops facts without an https source", async () => {
    const r = await findMore(sampleMpc, "hint", {
      generate: fakeGenerate({
        facts: [
          { text: "Published article on coverage disputes", url: "https://example.test/a", quote: Q },
          { text: "Award", url: "", quote: Q },
          { text: "Talk", url: "http://example.test/b", quote: Q },
          { text: "Bad url", url: "https://", quote: Q },
          { text: "Not a url", url: "not a url", quote: Q },
        ],
      }),
    });
    expect(r.facts).toEqual([{ text: "Published article on coverage disputes", url: "https://example.test/a", quote: Q }]);
  });

  test("drops facts whose quote is under 20 characters after whitespace normalization", async () => {
    const r = await findMore(sampleMpc, "", {
      generate: fakeGenerate({
        facts: [
          { text: "Short", url: "https://example.test/a", quote: "article     of   it" },
          { text: "Long enough", url: "https://example.test/b", quote: `  ${Q}\n` },
        ],
      }),
    });
    expect(r.facts.map((f) => f.text)).toEqual(["Long enough"]);
    expect(r.facts[0].quote).toBe(Q);
  });

  test("sends hints and the web search tool to the model", async () => {
    const gen = fakeGenerate({ facts: [] });
    await findMore(sampleMpc, "currently at Example LLP, bar 12345", { generate: gen });
    const call = gen.calls[0];
    expect(call.prompt).toContain("currently at Example LLP, bar 12345");
    expect(call.prompt).toContain("Senior Litigation Associate");
    expect(call.prompt).toContain("Led discovery on a large matter");
    expect(Object.keys(call.tools ?? {})).toContain("web_search");
    expect(call.system).toMatch(/never names, emails, phones, addresses, compensation or immigration status/i);
    expect(call.system).not.toContain("—");
  });

  test("tolerates a malformed model result", async () => {
    expect((await findMore(sampleMpc, "", { generate: fakeGenerate(undefined) })).facts).toEqual([]);
    expect((await findMore(sampleMpc, "", { generate: fakeGenerate({ facts: "x" }) })).facts).toEqual([]);
  });
});
