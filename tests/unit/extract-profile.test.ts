import { describe, expect, test } from "vitest";
import { extractProfile, verifyFacts } from "@/lib/ai/extract-profile";
import { MODELS } from "@/lib/ai/models";
import { fakeGenerate } from "../helpers/fake-ai";

describe("extractProfile", () => {
  test("uses the extract model id", () => {
    expect(MODELS.extract).toBe("claude-sonnet-5-5");
  });

  test("drops facts whose quote is not in the source", async () => {
    const draft = await extractProfile(
      [{ kind: "resume", text: "First-chaired two jury trials to verdict.", ref: "resume.pdf" }],
      {
        generate: fakeGenerate({
          facts: [
            {
              text: "First-chaired two jury trials",
              sourceKind: "resume",
              sourceRef: "resume.pdf",
              sourceQuote: "First-chaired two jury trials to verdict.",
            },
            {
              text: "Won $50M verdict",
              sourceKind: "resume",
              sourceRef: "resume.pdf",
              sourceQuote: "Won a $50M verdict",
            },
          ],
        }),
      },
    );
    expect(draft.facts.map((f) => f.text)).toEqual(["First-chaired two jury trials"]);
  });

  test("quote check collapses whitespace but stays case sensitive", () => {
    const sources = [{ kind: "notes" as const, text: "Handled  appeals\nin the Ninth Circuit.", ref: "n.txt" }];
    const facts = [
      { text: "a", sourceKind: "notes" as const, sourceRef: "n.txt", sourceQuote: "Handled appeals in the Ninth Circuit." },
      { text: "b", sourceKind: "notes" as const, sourceRef: "n.txt", sourceQuote: "handled appeals in the ninth circuit." },
    ];
    expect(verifyFacts(facts, sources).map((f) => f.text)).toEqual(["a"]);
  });

  test("a quote must be in its own source, and an unknown source ref is dropped", () => {
    const sources = [
      { kind: "resume" as const, text: "Alpha text here for testing.", ref: "a.pdf" },
      { kind: "notes" as const, text: "Beta text here for testing.", ref: "b.txt" },
    ];
    const facts = [
      { text: "wrong source", sourceKind: "resume" as const, sourceRef: "a.pdf", sourceQuote: "Beta text here for testing." },
      { text: "unknown", sourceKind: "resume" as const, sourceRef: "zzz.pdf", sourceQuote: "Alpha text here for testing." },
      { text: "ok", sourceKind: "notes" as const, sourceRef: "b.txt", sourceQuote: "Beta text here for testing." },
    ];
    expect(verifyFacts(facts, sources).map((f) => f.text)).toEqual(["ok"]);
  });

  test("a quote under 20 characters after normalization is dropped", () => {
    const sources = [{ kind: "resume" as const, text: "Led discovery on a $120M matter.", ref: "r.pdf" }];
    const short = { text: "x", sourceKind: "resume" as const, sourceRef: "r.pdf", sourceQuote: "Led  discovery" };
    const exact = { text: "y", sourceKind: "resume" as const, sourceRef: "r.pdf", sourceQuote: "Led discovery on a $1" };
    expect(verifyFacts([short], sources)).toEqual([]);
    expect(verifyFacts([exact], sources).map((f) => f.text)).toEqual(["y"]);
  });

  test("source kind comes from the provided source, not the model claim", async () => {
    const draft = await extractProfile([{ kind: "transcript", text: "Wants to relocate to Denver.", ref: "call.txt" }], {
      generate: fakeGenerate({
        facts: [
          { text: "Open to Denver", sourceKind: "resume", sourceRef: "call.txt", sourceQuote: "Wants to relocate to Denver." },
        ],
      }),
    });
    expect(draft.facts[0].sourceKind).toBe("transcript");
  });

  test("keeps only known profile fields and valid suggested restrictions, and tolerates missing keys", async () => {
    const draft = await extractProfile([{ kind: "resume", text: "x", ref: "r.pdf" }], {
      generate: fakeGenerate({
        fields: { headlineRole: "Litigation Associate", yearsExperience: 8, payTarget: 999, location: null, seniority: "" },
        restrictionsSuggested: [
          { kind: "never_say", value: "the merger" },
          { kind: "bogus", value: "x" },
          { kind: "confidential", value: "  " },
        ],
      }),
    });
    expect(draft.fields).toEqual({ headlineRole: "Litigation Associate", yearsExperience: 8 });
    expect(draft.restrictionsSuggested).toEqual([{ kind: "never_say", value: "the merger" }]);
    expect(draft.facts).toEqual([]);
  });

  test("the prompt tells the model to ignore contact details and passes each source with its ref", async () => {
    const gen = fakeGenerate({});
    await extractProfile([{ kind: "resume", text: "Body of resume", ref: "r.pdf" }], { generate: gen });
    const call = gen.calls[0];
    expect(call.system).toMatch(/ignore/i);
    expect(call.system).toMatch(/email/i);
    expect(call.system).toMatch(/phone/i);
    expect(call.prompt).toContain("r.pdf");
    expect(call.prompt).toContain("Body of resume");
  });

  test("with no sources it does not call the model", async () => {
    const gen = fakeGenerate({});
    const draft = await extractProfile([], { generate: gen });
    expect(gen.calls).toHaveLength(0);
    expect(draft).toEqual({ fields: {}, facts: [], restrictionsSuggested: [] });
  });
});
