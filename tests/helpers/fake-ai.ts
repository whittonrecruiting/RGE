import type { AiUsage, GenerateFn } from "@/lib/ai/models";

type Calls = Parameters<GenerateFn>[0][];

/**
 * A GenerateFn that ignores its input and resolves to output. Records the calls it received.
 * With usage, it reports those numbers through onUsage like the real model call does.
 */
export function fakeGenerate(output: unknown, usage?: AiUsage): GenerateFn & { calls: Calls } {
  const calls: Calls = [];
  const fn = (async (args: Parameters<GenerateFn>[0]) => {
    calls.push(args);
    if (usage) args.onUsage?.(usage);
    return output;
  }) as GenerateFn & { calls: Calls };
  fn.calls = calls;
  return fn;
}
