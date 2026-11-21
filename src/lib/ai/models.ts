import { generateObject, generateText, isStepCount, Output, type ToolSet } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { ZodType } from "zod";

export const MODELS = { extract: "claude-sonnet-5-5" } as const;

/**
 * Asks the model for structured output. Callers pass this in (deps) so tests can fake it.
 * When `tools` is given (provider tools such as web search) the model may use them before it
 * answers; the answer is still validated against `schema`.
 */
export type GenerateFn = <T>(args: {
  schema: ZodType<T>;
  system: string;
  prompt: string;
  tools?: Record<string, unknown>;
}) => Promise<T>;

export const defaultGenerate: GenerateFn = async ({ schema, system, prompt, tools }) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Set it in .env.local to use AI extraction.");
  }
  if (tools && Object.keys(tools).length > 0) {
    const { output } = await generateText({
      model: anthropic(MODELS.extract),
      system,
      prompt,
      tools: tools as ToolSet,
      output: Output.object({ schema }),
      stopWhen: isStepCount(6),
    });
    return output;
  }
  const { object } = await generateObject({ model: anthropic(MODELS.extract), schema, system, prompt });
  return object;
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
