/**
 * The draft guard for pitch bullets (spec section 8), shared by the Sample pitch and saved bullets.
 * Pure: no database or model access, safe to import anywhere. The rules lean strict: brand damage
 * from an invented or inflated fact costs far more than a dropped bullet.
 */

const EM_DASH = String.fromCharCode(0x2014);

const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  mil: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  t: 1e12,
  trillion: 1e12,
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, dozen: 12, dozens: 12, hundreds: 100, thousands: 1000,
  single: 1, double: 2, triple: 3, first: 1, second: 2, third: 3,
};

// A figure with an optional scale word: $120M, $120 million, $120,000,000, 1.2bn, 45%. A scale
// letter followed by "&" is not a scale ("12 M&A deals").
const FIGURE = /(\d[\d,]*(?:\.\d+)?)(?:\s*(k|thousand|mm|mil|million|m|bn|billion|b|trillion|t)\b(?!&))?/gi;
const WORD_NUMBER = new RegExp(String.raw`\b(${Object.keys(WORD_NUMBERS).join("|")})\b`, "gi");

type Figure = { raw: string; value: number };

function figuresIn(text: string): Figure[] {
  const found: (Figure & { at: number })[] = [];
  for (const m of text.matchAll(FIGURE)) {
    const digits = m[1].replace(/,+$/, "").replace(/,/g, "");
    const base = Number(digits);
    if (!Number.isFinite(base)) continue;
    const scale = m[2] ? (MULTIPLIERS[m[2].toLowerCase()] ?? 1) : 1;
    found.push({ at: m.index ?? 0, raw: m[0].trim(), value: Math.round(base * scale * 1e6) / 1e6 });
  }
  for (const m of text.matchAll(WORD_NUMBER)) {
    found.push({ at: m.index ?? 0, raw: m[1], value: WORD_NUMBERS[m[1].toLowerCase()] });
  }
  return found.sort((a, b) => a.at - b.at).map(({ raw, value }) => ({ raw, value }));
}

/** Every number in the text as a plain value, in order of appearance. $120M, $120 million and $120,000,000 are all 120000000. */
export function numbersIn(text: string): number[] {
  return figuresIn(text).map((f) => f.value);
}

const sameNumber = (a: number, b: number) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-9;

const PAY = [
  /\b(salary|salaries|compensation|wage|wages|bonus|bonuses|ote|paycheck|pay\s+(range|target|floor|expectations?)|base\s+pay|total\s+comp|comp\s+package)\b/i,
  /\$\s?\d[\d,.]*\s?k\b.{0,20}\bbase\b/i,
  /\bbase\b.{0,20}\$\s?\d[\d,.]*\s?k\b/i,
  /\b(seeking|wants|asking|targeting|expects)\s+\$/i,
  /\b\d[\d,.]*\s?k\s+(base|a\s+year|per\s+year|annually)\b/i,
];
const WORK_AUTH =
  /\b(visas?|h-?1b|h-?1|green\s+card|work\s+authori[sz]ation|authori[sz]ed\s+to\s+work|sponsorship|sponsor|citizen|citizenship|immigration|ead|opt|tn\s+status|work\s+permit)\b/i;
const PLACEHOLDER = /\[[^\]]*\]|\{[^}]*\}|<[^>]*>/;
const LINK = /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|org|io|co|law|test)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const BOLD = /\*\*|__/;

export type PhraseRules = { minWords: number; maxWords: number; label: string };

/**
 * Checks a pitch phrase against the text it must stay true to. Returns the first problem as a
 * sentence for the recruiter, or null when the phrase passes.
 */
export function checkPhrase(text: string, sourceText: string, rules: PhraseRules): string | null {
  const t = typeof text === "string" ? text.trim() : "";
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < rules.minWords || words.length > rules.maxWords) {
    return `Keep the ${rules.label} to ${rules.minWords} to ${rules.maxWords} words.`;
  }
  if (t.includes(EM_DASH)) return `Remove em dashes from the ${rules.label}.`;
  if (PLACEHOLDER.test(t)) return `Remove placeholders like [Name] from the ${rules.label}.`;
  if (LINK.test(t)) return `Remove links from the ${rules.label}.`;
  if (BOLD.test(t)) return `Remove bold text from the ${rules.label}.`;
  if (EMOJI.test(t)) return `Remove emojis from the ${rules.label}.`;
  if (PAY.some((p) => p.test(t))) return `Leave pay out of the ${rules.label}.`;
  if (WORK_AUTH.test(t)) return `Leave visa and work authorization out of the ${rules.label}.`;
  const allowed = numbersIn(sourceText);
  const extra = figuresIn(t).find((f) => !allowed.some((a) => sameNumber(a, f.value)));
  if (extra) return `The ${rules.label} has a number that is not in its fact: ${extra.raw}.`;
  return null;
}

/** One pitch bullet against its own fact: 3 to 12 words, nothing the fact does not say. */
export function checkBullet(text: string, factText: string): string | null {
  return checkPhrase(text, factText, { minWords: 3, maxWords: 12, label: "bullet" });
}

/** The [specific background] phrase, checked against the facts the pitch uses. */
export function checkBackground(text: string, factTexts: string[]): string | null {
  return checkPhrase(text, factTexts.join("\n"), { minWords: 2, maxWords: 8, label: "background phrase" });
}

/** The never-say or confidential restriction value the text contains, if any. */
export function restrictedTerm(text: string, restricted: string[]): string | null {
  const lower = text.toLowerCase();
  return restricted.find((r) => r.trim() !== "" && lower.includes(r.trim().toLowerCase())) ?? null;
}

/** Why an MPC is not pitch ready yet. */
export function strongFactsMessage(count: number): string {
  const tail = "Confirm a note or run Find more.";
  if (count <= 0) return `No strong facts yet. ${tail}`;
  return `Only ${count} strong ${count === 1 ? "fact" : "facts"}. ${tail}`;
}
