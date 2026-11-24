import { Resolver } from "node:dns/promises";

export type CheckResult = { ok: boolean; found: string | null; fix: string | null };
export type DomainCheck = { spf: CheckResult; dkim: CheckResult; dmarc: CheckResult };
/** The shape of node:dns/promises resolveTxt: one entry per record, each split into chunks. */
export type TxtResolver = (name: string) => Promise<string[][]>;

const SPF_FIX = "Add `include:_spf.google.com` to your SPF record in your DNS provider.";
const DKIM_FIX =
  "Turn on DKIM signing in Google Admin (Apps > Google Workspace > Gmail > Authenticate email) and publish the record.";
const dmarcFix = (domain: string) =>
  `Add a DMARC record at _dmarc.${domain} that starts with v=DMARC1 (for example v=DMARC1; p=none) in your DNS provider.`;

// NXDOMAIN surfaces in Node as ENOTFOUND; ENODATA means the name exists without TXT records.
const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

function systemResolver(): TxtResolver {
  const r = new Resolver({ timeout: 5000, tries: 2 });
  return (name) => r.resolveTxt(name);
}

let testResolver: TxtResolver | undefined;

/** Test only: replace the default DNS resolver used when checkDomain gets none. */
export function setTestTxtResolver(resolver: TxtResolver | undefined): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setTestTxtResolver is only available when NODE_ENV is 'test'");
  testResolver = resolver;
}

/** TXT records at name, chunks joined. Not found is an empty list; other DNS failures throw. */
async function txt(resolve: TxtResolver, name: string): Promise<string[]> {
  try {
    return (await resolve(name)).map((chunks) => chunks.join(""));
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (typeof code === "string" && NOT_FOUND.has(code)) return [];
    throw err;
  }
}

const pass = (found: string): CheckResult => ({ ok: true, found, fix: null });
const failWith = (found: string | null, fix: string): CheckResult => ({ ok: false, found, fix });

/** SPF, DKIM (Google selector) and DMARC checks for a sending domain. */
export async function checkDomain(domain: string, resolve?: TxtResolver): Promise<DomainCheck> {
  const d = domain.trim().toLowerCase();
  const r = resolve ?? testResolver ?? systemResolver();
  const [root, dkimRecs, dmarcRecs] = await Promise.all([txt(r, d), txt(r, `google._domainkey.${d}`), txt(r, `_dmarc.${d}`)]);

  const spfRecs = root.filter((t) => /^v=spf1(\s|$)/i.test(t.trim()));
  const spfGood = spfRecs.find((t) => /(^|\s)include:_spf\.google\.com(\s|$)/i.test(t));
  const spf = spfGood ? pass(spfGood) : failWith(spfRecs[0] ?? null, SPF_FIX);

  const dkimGood = dkimRecs.find((t) => /v=DKIM1/i.test(t) || /(^|;)\s*p=/i.test(t));
  const dkim = dkimGood ? pass(dkimGood) : failWith(null, DKIM_FIX);

  const dmarcGood = dmarcRecs.find((t) => /^v=DMARC1(\s|;|$)/i.test(t.trim()));
  const dmarc = dmarcGood ? pass(dmarcGood) : failWith(null, dmarcFix(d));

  return { spf, dkim, dmarc };
}

/** A stored domain_check value as DomainCheck, or null when missing or malformed. */
export function parseDomainCheck(value: unknown): DomainCheck | null {
  const isResult = (v: unknown): v is CheckResult => {
    if (!v || typeof v !== "object") return false;
    const c = v as Record<string, unknown>;
    return (
      typeof c.ok === "boolean" &&
      (c.found === null || typeof c.found === "string") &&
      (c.fix === null || typeof c.fix === "string")
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return isResult(v.spf) && isResult(v.dkim) && isResult(v.dmarc) ? { spf: v.spf, dkim: v.dkim, dmarc: v.dmarc } : null;
}
