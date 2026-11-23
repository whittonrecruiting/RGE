/**
 * The draft guard for pitch bullets (spec section 8), shared by the Sample pitch and saved bullets.
 * Pure: no database or model access, safe to import anywhere. The rules lean strict: brand damage
 * from an invented or inflated fact costs far more than a dropped bullet.
 */

const EM_DASH = String.fromCharCode(0x2014);

const SCALES: Record<string, number> = {
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
// Scale words that may follow a spelled number ("two billion").
const WORD_SCALES: Record<string, number> = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, thousand: 1000, dozen: 12, single: 1, double: 2, triple: 3, first: 1,
  second: 2, third: 3,
};

/**
 * Words that claim a size without a number. The value is the smallest figure that backs the claim:
 * "hundreds (of)" needs at least 200, "multimillion" at least 2 million. Any "N-figure" (six-figure,
 * ten-figure, 7-figure) needs at least 10^(N-1); see figureMin.
 */
const N_FIGURE = String.raw`(?:${Object.keys(WORD_NUMBERS).join("|")}|\d+)[\s-]figures?`;

/** "seven-figure" and "7-figure" both need at least 1,000,000 (10^(N-1)). */
function figureMin(key: string): number {
  const n = key.split(/[\s-]/)[0];
  const count = /^\d+$/.test(n) ? Number(n) : (WORD_NUMBERS[n] ?? 1);
  return 10 ** Math.max(0, count - 1);
}

const MAGNITUDES: { pattern: string; min: number; dollars?: true }[] = [
  { pattern: String.raw`multi-?trillion`, min: 2e12 },
  { pattern: String.raw`multi-?billion`, min: 2e9 },
  { pattern: String.raw`multi-?million`, min: 2e6 },
  { pattern: String.raw`trillion-dollar`, min: 1e12, dollars: true },
  { pattern: String.raw`billion-dollar`, min: 1e9, dollars: true },
  { pattern: String.raw`million-dollar`, min: 1e6, dollars: true },
  { pattern: N_FIGURE, min: 0 },
  { pattern: String.raw`trillions`, min: 2e12 },
  { pattern: String.raw`billions`, min: 2e9 },
  { pattern: String.raw`millions`, min: 2e6 },
  { pattern: String.raw`hundreds(?:\s+of)?`, min: 200 },
  { pattern: String.raw`thousands(?:\s+of)?`, min: 2000 },
  { pattern: String.raw`dozens(?:\s+of)?`, min: 24 },
  { pattern: String.raw`trillion`, min: 1e12 },
  { pattern: String.raw`billion`, min: 1e9 },
  { pattern: String.raw`million`, min: 1e6 },
];

const SCALE_ALT = "k|thousand|mm|mil|million|m|bn|billion|b|trillion|t";
const WORD_ALT = Object.keys(WORD_NUMBERS).join("|");
const WORD_SCALE_ALT = Object.keys(WORD_SCALES).join("|");
const UNIT_AFTER = String.raw`(\s*%|\s+percent\b|\s+(?:dollars|usd)\b)?`;
// One pass, left to right. Alternatives: a magnitude word (multimillion, seven-figure, 10-figure,
// in the thousands), a written figure ($120M, $ 120 million, $120,000,000, 40+, 45%), or a spelled
// number with optional scales (two billion, one hundred million). Magnitudes come first so
// "seven-figure" and "10-figure" are not read as 7 or 10.
// A scale letter followed by "&" is not a scale ("12 M&A deals").
const FIGURE = new RegExp(
  [
    String.raw`\b(?<mag>${MAGNITUDES.map((m) => m.pattern).join("|")})\b`,
    String.raw`(?<cur>\$\s*|\busd\s*)?(?<digits>\d[\d,]*(?:\.\d+)?)(?<plus1>\+)?(?:\s*(?<scale>${SCALE_ALT})\b(?!&))?(?<plus2>\+)?${UNIT_AFTER.replace("(", "(?<unit1>")}`,
    String.raw`\b(?<word>${WORD_ALT})\b(?<wscale>(?:[\s-]+(?:${WORD_SCALE_ALT})\b)*)(?<plus3>\+)?${UNIT_AFTER.replace("(", "(?<unit2>")}`,
  ].join("|"),
  "gi",
);
// Qualifiers that raise a claim when they come right before a figure.
const RAISE_BEFORE = /\b(over|more than|nearly|almost|upwards of|at least|in excess of|north of|exceeding|above)\s*$/i;

type Unit = "$" | "%" | null;
type Figure =
  | { kind: "number"; raw: string; value: number; unit: Unit; raised: boolean }
  | { kind: "magnitude"; raw: string; min: number; dollars: boolean };

const unitOf = (cur: string | undefined, after: string | undefined): Unit => {
  const a = (after ?? "").trim().toLowerCase();
  if (a === "%" || a === "percent") return "%";
  if (cur || a === "dollars" || a === "usd") return "$";
  return null;
};

function figuresIn(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(FIGURE)) {
    const g = m.groups ?? {};
    const at = m.index ?? 0;
    const raw = m[0].trim();
    if (g.mag) {
      const key = g.mag.toLowerCase();
      const def = MAGNITUDES.find((d) => new RegExp(`^(?:${d.pattern})$`, "i").test(key))!;
      // "hundreds of" and "in the hundreds" are the same claim.
      const norm = key.replace(/\s+/g, " ").replace(/ of$/, "");
      const min = def.pattern === N_FIGURE ? figureMin(norm) : def.min;
      out.push({ kind: "magnitude", raw: norm, min, dollars: def.dollars === true });
      continue;
    }
    let value: number;
    if (g.digits !== undefined) {
      const base = Number(g.digits.replace(/,+$/, "").replace(/,/g, ""));
      if (!Number.isFinite(base)) continue;
      value = base * (g.scale ? (SCALES[g.scale.toLowerCase()] ?? 1) : 1);
    } else {
      value = WORD_NUMBERS[g.word.toLowerCase()];
      for (const w of (g.wscale ?? "").toLowerCase().split(/[\s-]+/).filter(Boolean)) value *= WORD_SCALES[w];
    }
    const raised = Boolean(g.plus1 || g.plus2 || g.plus3) || RAISE_BEFORE.test(text.slice(Math.max(0, at - 30), at));
    out.push({
      kind: "number",
      raw,
      value: Math.round(value * 1e6) / 1e6,
      unit: unitOf(g.cur, g.unit1 ?? g.unit2),
      raised,
    });
  }
  return out;
}

/** Every number in the text as a plain value, in order of appearance. $120M, $120 million and $120,000,000 are all 120000000. */
export function numbersIn(text: string): number[] {
  return figuresIn(text).flatMap((f) => (f.kind === "number" ? [f.value] : []));
}

const sameNumber = (a: number, b: number) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-9;

/**
 * True when the source backs the figure. A number needs the same value, in the same unit when it
 * has one ($ or %), and a raising qualifier (40+, over 40) needs one in the source too. A magnitude word
 * needs the same wording or a source figure at least that large (in dollars for "million-dollar").
 */
function backed(f: Figure, source: Figure[]): boolean {
  if (f.kind === "number") {
    // A unit on the claim ($ or %) must be in the source too.
    return source.some(
      (s) =>
        s.kind === "number" &&
        sameNumber(s.value, f.value) &&
        // A unitless claim may drop a $, but must not turn a percentage into a count.
        (f.unit === null ? s.unit !== "%" : s.unit === f.unit) &&
        (!f.raised || s.raised),
    );
  }
  return source.some((s) =>
    s.kind === "magnitude"
      ? s.raw === f.raw
      : s.unit !== "%" && s.value >= f.min && (!f.dollars || s.unit === "$"),
  );
}

/** The first figure in text that the source does not back, as written, or null. */
export function unbackedFigure(text: string, source: string): string | null {
  const allowed = figuresIn(source);
  return figuresIn(text).find((f) => !backed(f, allowed))?.raw ?? null;
}

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
  const extra = unbackedFigure(t, sourceText);
  if (extra) return `The ${rules.label} has a number that is not in its fact: ${extra}.`;
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
