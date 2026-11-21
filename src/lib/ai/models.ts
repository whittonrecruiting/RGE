import { generateObject, generateText, isStepCount, Output, type ToolSet } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { ZodType } from "zod";

export const MODELS = { extract: "claude-sonnet-5-5" } as const;

/** What one paid call used. Numbers the provider does not report are 0. */
export type AiUsage = { inputTokens: number; outputTokens: number; webSearches: number };
export const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };

/**
 * Asks the model for structured output. Callers pass this in (deps) so tests can fake it.
 * When `tools` is given (provider tools such as web search) the model may use them before it
 * answers; the answer is still validated against `schema`. onUsage receives the token and web
 * search counts once the model has answered (a fake may never call it: usage then stays 0).
 */
export type GenerateFn = <T>(args: {
  schema: ZodType<T>;
  system: string;
  prompt: string;
  tools?: Record<string, unknown>;
  onUsage?: (usage: AiUsage) => void;
}) => Promise<T>;

const count = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

export const defaultGenerate: GenerateFn = async ({ schema, system, prompt, tools, onUsage }) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Set it in .env.local to use AI extraction.");
  }
  if (tools && Object.keys(tools).length > 0) {
    const result = await generateText({
      model: anthropic(MODELS.extract),
      system,
      prompt,
      tools: tools as ToolSet,
      output: Output.object({ schema }),
      stopWhen: isStepCount(6),
    });
    onUsage?.({
      inputTokens: count(result.usage?.inputTokens),
      outputTokens: count(result.usage?.outputTokens),
      webSearches: (result.toolCalls ?? []).filter((c) => c.toolName === "web_search").length,
    });
    return result.output;
  }
  const result = await generateObject({ model: anthropic(MODELS.extract), schema, system, prompt });
  onUsage?.({ inputTokens: count(result.usage?.inputTokens), outputTokens: count(result.usage?.outputTokens), webSearches: 0 });
  return result.object;
};

let testGenerate: GenerateFn | undefined;

/** Test only: replace the model call used by server actions. */
export function setTestGenerate(fn: GenerateFn | undefined): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setTestGenerate is only available when NODE_ENV is 'test'");
  testGenerate = fn;
}

/** The model call server actions use. */
export function getGenerate(): GenerateFn {
  return testGenerate ?? defaultGenerate;
}
