import type { GenerateFn } from "@/lib/ai/models";

type Calls = Parameters<GenerateFn>[0][];

/** A GenerateFn that ignores its input and resolves to output. Records the calls it received. */
export function fakeGenerate(output: unknown): GenerateFn & { calls: Calls } {
  const calls: Calls = [];
  const fn = (async (args: Parameters<GenerateFn>[0]) => {
    calls.push(args);
    return output;
  }) as GenerateFn & { calls: Calls };
  fn.calls = calls;
  return fn;
}
