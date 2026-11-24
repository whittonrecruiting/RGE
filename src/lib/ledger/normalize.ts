// Pure normalization and matching helpers for the ledger. No database imports.

const FREEMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "zoho.com",
]);

const COMPANY_SUFFIXES = new Set([
  "llp",
  "llc",
  "inc",
  "pc",
  "pllc",
  "ltd",
  "corp",
  "corporation",
  "co",
  "company",
  "lp",
  "plc",
]);

const SIMPLE_ADDRESS = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/;

/** Trim and lowercase one address; null unless the input is exactly one address. */
export function normalizeEmail(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const angle = /^([^<>]*)<([^<>]*)>$/.exec(text);
  const candidate = (angle ? angle[2] : text).trim().toLowerCase();
  if (!SIMPLE_ADDRESS.test(candidate)) return null;
  if (candidate.endsWith(".") || candidate.includes("..")) return null;
  return candidate;
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/** Lowercase host without scheme, credentials, port, path or leading www; null if no dot. */
export function normalizeDomain(raw: string): string | null {
  let host = raw.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split(/[/?#]/)[0] ?? "";
  host = host.slice(host.lastIndexOf("@") + 1);
  host = host.replace(/:\d*$/, "");
  host = host.replace(/^www\./, "").replace(/\.+$/, "");
  if (!host.includes(".") || host.startsWith(".")) return null;
  return host;
}

export function isFreemail(domain: string): boolean {
  return FREEMAIL.has(domain.trim().toLowerCase());
}

/** True when domain equals blocked or is a subdomain of it (dot boundary). */
export function domainMatches(domain: string, blocked: string): boolean {
  return domain === blocked || domain.endsWith("." + blocked);
}

export function normalizeCompanyName(name: string): string {
  let text = name.toLowerCase().replace(/&/g, " and ");
  // Initialisms such as "L.L.P." become one token before dots are treated as word separators.
  text = text.replace(/(?<![\p{L}\p{N}])\p{L}(?:\.\p{L})+\.?(?![\p{L}\p{N}])/gu, (m) => m.replace(/\./g, ""));
  // Hyphens, slashes, dots, commas and underscores separate words ("Smith-Jones" equals "Smith Jones").
  text = text.replace(/[-/._,]/g, " ");
  text = text.replace(/[^\p{L}\p{N}\s]/gu, "");
  const words = text.split(/\s+/).filter(Boolean);
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1]!)) {
    words.pop();
  }
  return words.join(" ");
}

export function matchesDoNotContact(
  entry: { name: string; domains: string[]; aliases: string[] },
  target: { domain?: string | null; name?: string | null },
): boolean {
  const targetDomain = target.domain ? normalizeDomain(target.domain) : null;
  if (targetDomain) {
    for (const d of entry.domains) {
      const blocked = normalizeDomain(d);
      if (blocked && domainMatches(targetDomain, blocked)) return true;
    }
  }
  const targetName = target.name ? normalizeCompanyName(target.name) : "";
  if (!targetName) return false;
  return [entry.name, ...entry.aliases].some(
    (n) => normalizeCompanyName(n) === targetName,
  );
}

/** Split a header on commas that are outside quotes and angle brackets. */
function splitAddresses(header: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let inAngle = false;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i]!;
    if (inQuote && ch === "\\" && i + 1 < header.length) {
      current += ch + header[++i];
      continue;
    }
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === "<") inAngle = true;
    else if (!inQuote && ch === ">") inAngle = false;
    if (ch === "," && !inQuote && !inAngle) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

export function parseAddressList(
  header: string,
): { email: string; name: string | null }[] {
  const out: { email: string; name: string | null }[] = [];
  for (const part of splitAddresses(header)) {
    const text = part.trim();
    if (!text) continue;
    const email = normalizeEmail(text);
    if (!email) continue;
    let name: string | null = null;
    const angle = /^([^<>]*)<[^<>]*>$/.exec(text);
    if (angle) {
      let n = angle[1]!.trim();
      if (n.length >= 2 && n.startsWith('"') && n.endsWith('"')) {
        n = n.slice(1, -1).replace(/[\\](.)/g, "$1").trim();
      }
      name = n || null;
    }
    out.push({ email, name });
  }
  return out;
}
