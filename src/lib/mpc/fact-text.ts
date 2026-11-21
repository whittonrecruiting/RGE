/**
 * The one validator for fact text, on every entry path: facts typed or edited by hand, and facts
 * saved from profile extraction or Find more. Trims, then requires 1 to 300 characters and no em dash.
 */
export const MAX_FACT_CHARS = 300;
const EM_DASH = String.fromCharCode(0x2014);

export type CleanFactText = { ok: true; text: string } | { ok: false; error: string };

export function cleanFactText(raw: unknown): CleanFactText {
  if (typeof raw !== "string") return { ok: false, error: "Enter the fact." };
  const text = raw.trim();
  if (text === "") return { ok: false, error: "Enter the fact." };
  if (text.length > MAX_FACT_CHARS) return { ok: false, error: `Keep the fact to ${MAX_FACT_CHARS} characters or fewer.` };
  if (text.includes(EM_DASH)) return { ok: false, error: "Remove em dashes from this fact." };
  return { ok: true, text };
}
