# RGE Plan 2: Ledger and Inboxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recruiters can connect their Gmail inboxes, RGE builds one agency-wide record of who was emailed and when (from Gmail history and WR's old bot logs), opt-outs and bounces are permanently suppressed, and the do-not-contact company list is maintained by hand or CSV, so that nothing in Plans 3 to 5 can contact someone it should not.

**Architecture:**
- Nine new agency-owned tables under the same row-level security as Plan 1.
  - Ledger events and suppressions are append-only for the app role: no UPDATE or DELETE grants.
- Gmail is reached by plain `fetch` against Google's REST endpoints, through an internal Workspace OAuth app. Refresh tokens are encrypted with AES-256-GCM before they reach the database.
- A Vercel Cron route runs a bounded "sync tick" every 5 minutes. Each tick:
  - walks every enabled agency (looked up through `withSystem`);
  - syncs each connected inbox under `withAgency`;
  - backfills 365 days of mail, then follows the Gmail history feed;
  - saves a cursor after every page, so an interrupted tick resumes where it stopped.
- WR's old bot files are imported through an Owner/Admin upload in Settings. The upload shows a preview first, and importing is idempotent through dedupe keys.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle ORM + Neon Postgres (PGlite in tests), Clerk, Vitest, Playwright, Vercel Cron, Node `crypto` and `dns/promises`. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-20-rge-v1-design.md` (sections 3, 7 order of work items 1 to 3, 10 connect and domain checks, 12 opt-out and bounce, 14 opt-out list, 16, 17, 18, 19, 21, 22). Roadmap: `docs/superpowers/plans/2026-11-21-rge-roadmap.md`.

## Global Constraints

- Never commit candidate names, prospect or client contacts, email addresses, resumes, compensation, Loxo or Paraform exports, or any credential. Test fixtures use made-up names and `example.com`, `example.org` or `example.net` addresses only.
- Secrets live in `.env.local` and Vercel env vars, never in code. New secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RGE_TOKEN_KEY` (base64 of 32 random bytes), `CRON_SECRET`.
- "Opt-outs and bounces are permanently suppressed." The app role can insert suppressions and never update or delete them (enforced by grants, tested).
- "Never contact companies on the agency's do-not-contact list"; "entries match the company's domains and any parent or subsidiary names entered as aliases, and companies stay blocked until removed."
- "Work email for prospects, personal email for candidates." Free-mail domains never become companies.
- "OAuth tokens and API keys encrypted at rest; never logged." No token, code or Authorization header appears in any log line, error message or returned value.
- "Agency data isolated at the database level." Every new table is added to `src/db/rls.sql` with `agency_isolation`, ENABLE and FORCE, and the isolation test lists it.
- Gmail scopes are exactly `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send`. The send scope is requested now so recruiters connect once; nothing in Plan 2 sends.
- The ledger stores addresses, names, dates, message ids and thread ids. It never stores subjects or bodies (privacy minimization; repeat checks do not need them).
- Repeat window default 60 days (`settings.repeatWindowDays`, existing). Gmail backfill goes back `max(365, repeatWindowDays)` days. That covers "back to the start of MPC outreach (October 2026) or the longest repeat window, whichever is earlier."
- UI copy: plain, no em dashes, no emojis, no hype. Every new screen is checked at 390 px and 1440 px with no horizontal scroll (existing `tests/e2e/fit.ts`).
- Every server action calls `requireMember()` itself and checks `can(...)`. All database access goes through `withAgency` or `withSystem`.

## Calls made in this plan (check these)

1. **The MPC roster is not imported by file.** WR's 21 MPCs are re-added through the existing Add MPC flow (paste each block). The roster file is free text, and the sources-first flow already extracts and reviews it.
2. **Historic replies are not classified.** Old inbound mail is recorded as `received` (it counts for repeat checks). WR's existing opt-outs come from its suppression files. Reply classification starts in Plan 5.
3. **Bounces in Gmail history are detected only from failure notices.** A Gmail "Delivery Status Notification (Failure)" with an `X-Failed-Recipients` header is a bounce. Delay notices are not.
4. **The background runner is Vercel Cron plus saved cursors.** Plan 5 picks the durable runner for spaced sends.
5. **Do-not-contact entries can be removed** by Owners and Admins ("blocked until removed"). Suppressions cannot be removed in the app at all.
6. **Mailing-list and automated inbound mail is skipped.** Mail carrying `List-Unsubscribe`, `Precedence: bulk|list|junk`, or `Auto-Submitted` other than `no` is left out, so newsletters never become contacts.

## Review Focus

1. **Re-importing the same WR file twice.** The second import adds nothing and the preview says so. Owned by Task 9; test `re-importing the same send log inserts nothing`.
2. **Subdomains and look-alike domains in the do-not-contact list.** `us.firm-example.com` is blocked by `firm-example.com`. `notfirm-example.com` is not. Owned by Task 2; test `domain match respects dot boundaries`.
3. **A token that Google revoked mid-sync.** The inbox goes to `needs_reconnect`, the tick moves on to the next inbox, and the cursor is kept. Owned by Task 6; test `invalid_grant marks the inbox needs_reconnect and keeps the cursor`.
4. **Dates with no time zone in old CSVs.** They are read as wall time in the agency time zone. An unparseable date skips that row with a reason and is never replaced by "now". Owned by Task 9; test `bad dates skip the row with a reason`.
5. **A recruiter connecting a mailbox already connected by a teammate.** The connection is refused with a clear message and the existing connection is untouched. Owned by Task 5; test `connecting an inbox owned by another member is refused`.

---

## File Structure

```
drizzle/0014_ledger_inboxes.sql            generated: enums and tables
drizzle/0015_rls_ledger_inboxes.sql        custom: RLS and grants (appended to src/db/rls.sql)
src/db/schema.ts                           + companies, companyDomains, contacts, ledgerEvents,
                                             suppressions, doNotContact, inboxes, inboxCredentials
src/lib/permissions.ts                     + inbox.connect, inbox.manage, dnc.edit, suppression.add, history.import
src/lib/ledger/normalize.ts                pure: emails, domains, free-mail, company names, matching
src/lib/ledger/record.ts                   recordEvents(): companies, contacts, events, suppressions
src/lib/ledger/checks.ts                   read checks used by Plans 3 and 5
src/lib/google/crypto.ts                   token encryption and OAuth state signing
src/lib/google/client.ts                   GoogleApi interface, fetch implementation, test override
src/lib/inboxes/domain-check.ts            SPF, DKIM, DMARC checks
src/lib/inboxes/connect.ts                 completeConnection(), disconnectInbox(), setPrimaryInbox()
src/lib/inboxes/queries.ts                 listInboxes()
src/app/api/google/oauth/start/route.ts
src/app/api/google/oauth/callback/route.ts
src/lib/gmail-sync/parse.ts                pure: Gmail message metadata to ledger inputs
src/lib/gmail-sync/sync-inbox.ts           one inbox: backfill pages, then history
src/lib/gmail-sync/tick.ts                 all agencies, deadline-bounded
src/app/api/cron/gmail-sync/route.ts
src/lib/dnc/{actions,csv,queries}.ts
src/lib/suppressions/{actions,queries}.ts
src/lib/history-import/{csv,parsers,actions}.ts
src/components/settings/{inboxes-section,dnc-section,import-section}.tsx
src/components/campaign/{opt-outs,health-strip}.tsx
src/app/dev/{settings,campaign}/page.tsx   extended with sample data for the new sections
vercel.json                                + crons
README.md                                  + Google OAuth app setup, new env vars
```

---

### Task 1: Schema, row-level security and permissions

**Files:**
- Modify: `src/db/schema.ts`, `src/db/rls.sql`, `src/lib/permissions.ts`
- Create: `drizzle/0014_ledger_inboxes.sql` (via `npm run db:generate`), `drizzle/0015_rls_ledger_inboxes.sql` (custom, `drizzle-kit generate --custom --name rls_ledger_inboxes`)
- Test: `tests/unit/db/isolation.test.ts`, `tests/unit/db/ledger-grants.test.ts`, `tests/unit/permissions.test.ts`

**Interfaces:**
- Produces enums:
  - `ledgerEventType`: proposed, drafted, approved, denied, sent, follow_up_sent, received, replied_interested, replied_declined, opted_out, bounced, out_of_office, lead_stage_change, agreement_signed.
  - `ledgerSource`: rge, gmail, import, manual.
  - `suppressionReason`: opted_out, bounced, manual.
  - `inboxStatus`: connected, needs_reconnect, disconnected.
  - `dncSource`: manual, csv.
- Produces types exported from `schema.ts`: `LedgerEventType`, `LedgerSource`, `SuppressionReason`, `InboxStatus`, `DncSource`. Each is `(typeof <enum>.enumValues)[number]`.
- Produces tables. Every one has `id` and `agency_id` (cascade), and `timestamps` unless noted. Member references use `sameAgencyMember`.
  - `companies`: `name text not null`, `is_client boolean default false`, `unique(agency_id, id)`.
  - `company_domains`: `company_id` (same-agency FK, cascade), `domain text not null`, `unique(agency_id, domain)`.
  - `contacts`:
    - `email text not null` (normalized), `unique(agency_id, email)`.
    - `company_id` nullable, same-agency FK, set null.
    - `name text`, `title text`.
    - `unique(agency_id, id)`.
  - `ledger_events`:
    - What happened and to whom: `type`, `email text` (nullable), `domain text` (nullable).
    - References, all nullable:
      - `contact_id` and `company_id`, same-agency FKs;
      - `mpc_id`, same-agency FK, set null;
      - `user_id` (member);
      - `inbox_id`, same-agency FK.
    - Gmail and timing: `gmail_message_id`, `gmail_thread_id`, `occurred_at timestamptz not null`.
    - Provenance: `source`, `dedupe_key text not null`, `note text`, `created_at`.
    - No `updated_at`.
    - Constraints and indexes: `unique(agency_id, dedupe_key)`; indexes `(agency_id, email, occurred_at)`, `(agency_id, company_id, occurred_at)`, `(agency_id, type, occurred_at)`.
  - `suppressions`:
    - `email text not null`, `reason`, `source ledgerSource`, `note text`.
    - `created_by` (member, nullable), `created_at`.
    - `unique(agency_id, email)`.
  - `do_not_contact`:
    - `name text not null`.
    - `domains text[] not null default {}`, `aliases text[] not null default {}`.
    - `source`, `note text`, `created_by` (member).
  - `inboxes`:
    - Identity and owner: `user_id` (member), `email text not null`, `provider text not null default 'gmail'`, `unique(agency_id, email)`.
    - State: `status`, `is_primary boolean default false`, `signature_html text`.
    - Domain check: `domain_check jsonb`, `domain_checked_at`.
    - Backfill: `backfill_from timestamptz not null`, `backfill_cursor jsonb`, `backfill_done_at`.
    - Sync: `history_id text`, `last_synced_at`, `last_sync_error text`.
    - `unique(agency_id, id)`.
  - `inbox_credentials`:
    - `inbox_id` (same-agency FK, cascade), `unique(inbox_id)`.
    - `refresh_token_enc text not null`, `scopes text[] not null`, `updated_at`.
- Grants in `0015` for `rge_app`. Every table gets `agency_isolation` plus ENABLE and FORCE:

  | Table | Grants |
  |---|---|
  | `companies`, `company_domains`, `contacts`, `inboxes` | SELECT, INSERT, UPDATE |
  | `ledger_events`, `suppressions` | SELECT, INSERT only |
  | `do_not_contact`, `inbox_credentials` | SELECT, INSERT, UPDATE, DELETE |

  `rge_system` gets nothing new.
- Produces `Action` additions in `can()`:
  - `inbox.connect`: any member.
  - `inbox.manage`: target `ownerUserId`; the owner of the inbox or a manager.
  - `dnc.edit`: managers.
  - `suppression.add`: any member.
  - `history.import`: managers.

- [ ] **Step 1: Write failing tests.**
  - In `isolation.test.ts`:
    - extend the `scoped` list with the nine tables;
    - extend `rlsMigrations` with `0015_rls_ledger_inboxes.sql`.
  - New `ledger-grants.test.ts`:
    - `rge_app cannot update or delete ledger_events or suppressions`: insert one row of each through `withAgency`, then expect `update` and `delete` to reject with `permission denied`.
    - `agency B cannot see agency A's ledger, suppressions, inboxes or credentials`: seed two agencies, insert as A, select as B, expect 0 rows each.
    - `a ledger event cannot reference another agency's contact`: expect a foreign key violation.
  - In `permissions.test.ts`:
    - `recruiter can manage own inbox only` (`inbox.manage` with own vs another `ownerUserId`);
    - `only managers edit do-not-contact and import history`;
    - `any member can add a suppression`.
- [ ] **Step 2: Run `npx vitest run tests/unit/db tests/unit/permissions.test.ts`.** Expected: FAIL (tables and actions missing).
- [ ] **Step 3: Implement.**
  - Add the schema and run `npm run db:generate`.
  - Write `0015` and append it verbatim to `src/db/rls.sql`.
  - Add the actions to `permissions.ts`.
- [ ] **Step 4: Run the same command.** Expected: PASS. Then run `npx vitest run`: all green.
- [ ] **Step 5: Commit** `feat(db): ledger, suppressions, do-not-contact, companies, contacts and inbox tables with RLS`.

### Task 2: Normalization and matching

**Files:**
- Create: `src/lib/ledger/normalize.ts`
- Test: `tests/unit/ledger-normalize.test.ts`

**Interfaces:**
- Produces:
  - `normalizeEmail(raw: string): string | null`: trims and lowercases; `null` unless it matches one `local@domain.tld`. Strips a surrounding display name and angle brackets (`"Pat Doe <Pat@Example.com>"` gives `pat@example.com`).
  - `domainOf(email: string): string`
  - `normalizeDomain(raw: string): string | null`: lowercases; strips scheme, path, port and a leading `www.`; `null` if it has no dot.
  - `isFreemail(domain: string): boolean`. List: gmail.com, googlemail.com, yahoo.com, ymail.com, outlook.com, hotmail.com, live.com, msn.com, icloud.com, me.com, mac.com, aol.com, proton.me, protonmail.com, gmx.com, zoho.com.
  - `domainMatches(domain: string, blocked: string): boolean`: equal, or ends with `"." + blocked`.
  - `normalizeCompanyName(name: string): string`:
    - lowercases;
    - turns `&` into `and`;
    - drops punctuation;
    - removes trailing suffix words `llp|llc|inc|pc|pllc|ltd|corp|corporation|co|company|lp|plc` repeatedly;
    - collapses spaces.
  - `matchesDoNotContact(entry: { name: string; domains: string[]; aliases: string[] }, target: { domain?: string | null; name?: string | null }): boolean`: true on any domain match, or when the normalized target name equals the normalized entry name or any alias.
  - `parseAddressList(header: string): { email: string; name: string | null }[]`: comma-separated, with quoted display names that may contain commas.

- [ ] **Step 1: Write failing tests.**
  - `normalizeEmail` handles case, spaces and display names; `normalizeEmail("not an email")` is null.
  - `domain match respects dot boundaries`:
    - `domainMatches("us.firm-example.com", "firm-example.com")` is true;
    - `domainMatches("notfirm-example.com", "firm-example.com")` is false.
  - `normalizeCompanyName("Smith & Jones, L.L.P.")` equals `normalizeCompanyName("smith and jones llp")` equals `"smith and jones"`.
  - `matchesDoNotContact` matches:
    - by alias ("Parent Holdings Inc" matches an entry with alias "Parent Holdings");
    - by subdomain;
    - not when only part of a name overlaps ("Jones" vs "Smith and Jones").
  - `parseAddressList('"Doe, Pat" <pat@example.com>, lee@example.org')` gives two entries.
  - `isFreemail("gmail.com")` is true; `isFreemail("example.com")` is false.
- [ ] **Step 2: Run `npx vitest run tests/unit/ledger-normalize.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement the functions above** in `normalize.ts`.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ledger): email, domain and company-name normalization and do-not-contact matching`.

### Task 3: Recording events and the read checks

**Files:**
- Create: `src/lib/ledger/record.ts`, `src/lib/ledger/checks.ts`
- Test: `tests/unit/ledger-record.test.ts`, `tests/unit/ledger-checks.test.ts`

**Interfaces:**
- Consumes: Task 1 tables; Task 2 `normalizeEmail`, `domainOf`, `isFreemail`, `matchesDoNotContact`.
- Produces:
  ```ts
  export type LedgerInput = {
    type: LedgerEventType; email?: string | null; name?: string | null; companyName?: string | null;
    occurredAt: Date; source: LedgerSource; dedupeKey: string;
    inboxId?: string | null; userId?: string | null; mpcId?: string | null;
    gmailMessageId?: string | null; gmailThreadId?: string | null; note?: string | null;
  };
  export async function recordEvents(tx: Tx, agencyId: string, inputs: LedgerInput[],
    opts: { ownDomains: string[] }): Promise<{ inserted: number; skipped: number }>;
  export async function addSuppression(tx: Tx, agencyId: string,
    s: { email: string; reason: SuppressionReason; source: LedgerSource; note?: string | null; createdBy?: string | null })
    : Promise<"added" | "already">;
  ```
- `recordEvents` behavior:
  - Normalizes the email. Inputs with an invalid email are skipped, except `agreement_signed`, which needs only `companyName`.
  - Upserts a company and its `company_domains` row when the domain is neither free-mail nor own-domain. A new company is named after its domain unless `companyName` is given.
  - Upserts the contact. A name is filled in only when it was null.
  - Inserts the event with `on conflict (agency_id, dedupe_key) do nothing`.
  - For `opted_out` and `bounced`, also calls `addSuppression` with that reason.
  - For `agreement_signed`, sets `companies.is_client = true`.
  - `inserted` counts new event rows only.
- Produces checks (all agency-scoped by RLS; `tx` comes from `withAgency`):
  ```ts
  export async function suppressionFor(tx: Tx, email: string): Promise<{ reason: SuppressionReason; createdAt: Date } | null>;
  export async function lastContactAt(tx: Tx, email: string): Promise<Date | null>; // latest sent | follow_up_sent | received
  export async function companyActivity(tx: Tx, domain: string, since: Date):
    Promise<{ companyId: string | null; contactedEmails: string[]; declinedAt: Date | null; isClient: boolean }>;
  export async function doNotContactMatch(tx: Tx, target: { domain?: string | null; name?: string | null }):
    Promise<{ id: string; name: string } | null>;
  ```

- [ ] **Step 1: Write failing tests.**
  - `recording a sent event creates company, domain and contact once`: record the same input twice; expect one event, one contact, one company, with `inserted` 1 then 0.
  - `free-mail and own-domain addresses never create companies`.
  - `bounced input adds a permanent suppression and a second bounce reports already`.
  - `agreement_signed with only a company name marks a new company as client`.
  - `lastContactAt ignores denied, drafted and proposed events`.
  - `companyActivity lists distinct emails contacted since the date and the latest decline`. Seed `replied_declined` directly.
  - `doNotContactMatch finds an entry by alias and by subdomain`.
- [ ] **Step 2: Run `npx vitest run tests/unit/ledger-record.test.ts tests/unit/ledger-checks.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** `record.ts` and `checks.ts`. `doNotContactMatch` loads the agency's entries and applies `matchesDoNotContact`; lists are small, and this avoids array-operator SQL that differs on PGlite.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ledger): record events with company and contact upserts; suppression and repeat checks`.

### Task 4: Token encryption, OAuth state and the Google client

**Files:**
- Create: `src/lib/google/crypto.ts`, `src/lib/google/client.ts`
- Test: `tests/unit/google-crypto.test.ts`, `tests/unit/google-client.test.ts`

**Interfaces:**
- Produces in `crypto.ts`:
  - `encryptToken(plain: string): string`: format `v1:<iv b64>:<tag b64>:<ct b64>`, AES-256-GCM, key from `RGE_TOKEN_KEY`.
  - `decryptToken(enc: string): string`: throws `TokenKeyError` on a wrong key or a tampered value.
  - `tokenKeyConfigured(): boolean`.
  - `signOAuthState(p: { agencyId: string; userId: string; nonce: string; issuedAt: number }): string`: base64url JSON plus `.` plus HMAC-SHA256. The HMAC key is derived with HKDF from `RGE_TOKEN_KEY`, info `"oauth-state"`.
  - `verifyOAuthState(state: string, now?: number): { agencyId; userId; nonce } | null`: null when the signature is bad or the state is more than 10 minutes old.
- Produces in `client.ts`:
  ```ts
  export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"];
  export class GoogleAuthError extends Error {}   // invalid_grant or revoked: needs reconnect
  export interface GoogleApi {
    exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; accessToken: string; scopes: string[] }>;
    accessToken(refreshToken: string): Promise<string>;               // throws GoogleAuthError on invalid_grant
    revoke(refreshToken: string): Promise<void>;
    profile(accessToken: string): Promise<{ emailAddress: string; historyId: string }>;
    sendAsSignature(accessToken: string, email: string): Promise<string | null>;
    listMessageIds(accessToken: string, q: string, pageToken?: string): Promise<{ ids: string[]; nextPageToken?: string }>;
    messageMetadata(accessToken: string, id: string): Promise<GmailMeta>;
    history(accessToken: string, startHistoryId: string, pageToken?: string):
      Promise<{ messageIds: string[]; historyId: string; nextPageToken?: string } | "expired">;  // 404 means expired
  }
  export type GmailMeta = { id: string; threadId: string; internalDate: number; labelIds: string[];
    headers: Record<string, string> };  // lowercase names: from, to, cc, bcc, date, x-failed-recipients,
                                        // list-unsubscribe, precedence, auto-submitted, subject (read for DSN detection, never stored)
  export function googleApi(): GoogleApi;          // test override wins, else the fetch implementation
  export function setTestGoogleApi(api: GoogleApi | undefined): void;  // test only, NODE_ENV guard like setTestFileStore
  ```
- Fetch implementation details:
  - Endpoints: `https://oauth2.googleapis.com/token`, `.../revoke`, and `https://gmail.googleapis.com/gmail/v1/users/me/...`.
  - `messageMetadata` requests `format=metadata` with the `metadataHeaders` listed above.
  - Retries 429 and 5xx up to 3 times with 1, 2 and 4 second backoff.
  - Error messages carry the status and Google's error code only, never request bodies or tokens.

- [ ] **Step 1: Write failing tests.**
  - `encrypt then decrypt round-trips and each encryption differs`.
  - `a tampered ciphertext or wrong key throws TokenKeyError`.
  - `OAuth state verifies, rejects a changed field, and expires after 10 minutes`.
  - Client tests use a stubbed global `fetch`:
    - `invalid_grant on refresh throws GoogleAuthError`;
    - `history 404 returns "expired"`;
    - `a 500 then 200 retries and succeeds`;
    - `errors never include the refresh token`: assert the message does not contain the token string.
- [ ] **Step 2: Run `npx vitest run tests/unit/google-crypto.test.ts tests/unit/google-client.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** both files. Add `RGE_TOKEN_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `CRON_SECRET` placeholders to `.env.example` with one-line comments. Generate a local `RGE_TOKEN_KEY` into `.env.local` with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(google): encrypted refresh tokens, signed OAuth state and a Gmail REST client`.

### Task 5: Domain checks and connecting an inbox

**Files:**
- Create:
  - `src/lib/inboxes/domain-check.ts`, `src/lib/inboxes/connect.ts`, `src/lib/inboxes/queries.ts`
  - `src/app/api/google/oauth/start/route.ts`, `src/app/api/google/oauth/callback/route.ts`
- Test: `tests/unit/domain-check.test.ts`, `tests/unit/inbox-connect.test.ts`

**Interfaces:**
- Consumes: Task 4 `googleApi`, `encryptToken`, `signOAuthState` and `verifyOAuthState`; Task 1 tables.
- Produces in `domain-check.ts`:
  ```ts
  export type DomainCheck = { spf: CheckResult; dkim: CheckResult; dmarc: CheckResult };
  export type CheckResult = { ok: boolean; found: string | null; fix: string | null };
  export type TxtResolver = (name: string) => Promise<string[][]>;   // node:dns/promises resolveTxt shape
  export async function checkDomain(domain: string, resolve?: TxtResolver): Promise<DomainCheck>;
  ```
  - SPF: a TXT starting `v=spf1` that contains `include:_spf.google.com`.
  - DKIM: a TXT at `google._domainkey.<domain>` containing `v=DKIM1` or `p=`.
  - DMARC: a TXT at `_dmarc.<domain>` starting `v=DMARC1`.
  - NXDOMAIN or ENODATA counts as not found.
  - Each failing check has fix text, for example "Add `include:_spf.google.com` to your SPF record in your DNS provider." and "Turn on DKIM signing in Google Admin (Apps > Google Workspace > Gmail > Authenticate email) and publish the record."
- Produces in `connect.ts`:
  ```ts
  export type ConnectResult = { ok: true; inboxId: string } | { ok: false; error: string };
  export async function completeConnection(member: Member, code: string, redirectUri: string, now?: Date): Promise<ConnectResult>;
  export async function disconnectInbox(inboxId: string): Promise<{ ok: true } | { ok: false; error: string }>;  // server action
  export async function setPrimaryInbox(inboxId: string): Promise<{ ok: true } | { ok: false; error: string }>; // server action
  ```
- `completeConnection` steps:
  1. Exchange the code, and require both scopes in `GMAIL_SCOPES` to have been granted.
  2. Read the profile email.
  3. If the inbox email exists in the agency for another `user_id`, fail with "This inbox is already connected by a teammate."
  4. Upsert the inbox (status `connected`).
  5. Store the encrypted credential.
  6. Fetch the signature and run `checkDomain`.
  7. Set `backfill_from = now - max(365, repeatWindowDays) days`. Keep the cursor and history id when reconnecting.
  8. Make the inbox primary if the member has no primary inbox.
- `disconnectInbox`:
  - Revokes at Google; the revoke is best effort.
  - Deletes the credential and sets status `disconnected`.
  - Keeps the inbox row, because the ledger references it.
  - Permission is `inbox.manage` with the inbox's `user_id`.
- Produces in `queries.ts`:
  ```ts
  export type InboxView = { id: string; email: string; ownerName: string; isMine: boolean; status: InboxStatus;
    isPrimary: boolean; hasSignature: boolean; domainCheck: DomainCheck | null;
    backfillFrom: Date; backfillDoneAt: Date | null; lastSyncedAt: Date | null; lastSyncError: string | null; canManage: boolean };
  export async function listInboxes(member: Member): Promise<InboxView[]>;
  ```
- Routes:
  - `start` (GET):
    - `requireMember`, then `can(member, "inbox.connect")`.
    - Creates a random nonce and stores it in an httpOnly, Secure, SameSite=Lax cookie `rge_oauth_nonce` (10 minutes).
    - Redirects to `https://accounts.google.com/o/oauth2/v2/auth` with `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, the scopes and the signed state.
    - `redirect_uri` is `${request.nextUrl.origin}/api/google/oauth/callback`.
  - `callback` (GET):
    - `requireMember`.
    - Checks the state signature, the nonce cookie, and that the agency and user match the member. Then calls `completeConnection` and clears the cookie.
    - Redirects to `/settings?inbox=connected#inboxes`, or `?inbox_error=<short message>`.
    - When `GOOGLE_CLIENT_ID` or `RGE_TOKEN_KEY` is missing, both routes redirect with "Gmail connection is not set up yet."

- [ ] **Step 1: Write failing tests.**
  - `checkDomain` with a fake resolver:
    - `all three present passes`;
    - `missing DKIM fails with fix text`;
    - `resolver ENOTFOUND counts as missing, not a crash`.
  - `completeConnection` with `setTestGoogleApi` fake and `asMember`:
    - `connect stores an encrypted token, signature and backfill_from 365 days back`: decrypt the stored value and expect it to equal the fake refresh token.
    - `first inbox becomes primary, second does not`.
    - `connecting an inbox owned by another member is refused`.
    - `reconnecting your own inbox keeps its cursor and sets status connected`.
    - `missing gmail.send scope is refused with a message to allow all permissions`.
  - Disconnect:
    - `disconnect deletes the credential, keeps the row, and a recruiter cannot disconnect a teammate's inbox`.
- [ ] **Step 2: Run `npx vitest run tests/unit/domain-check.test.ts tests/unit/inbox-connect.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run again.** Expected: PASS. Also run `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(inboxes): connect Gmail through internal OAuth, domain checks, disconnect and primary inbox`.

### Task 6: Gmail sync (backfill, history, cron)

**Files:**
- Create:
  - `src/lib/gmail-sync/parse.ts`, `src/lib/gmail-sync/sync-inbox.ts`, `src/lib/gmail-sync/tick.ts`
  - `src/app/api/cron/gmail-sync/route.ts`
- Modify: `src/lib/public-paths.ts` (add prefix `/api/cron/`), `vercel.json` (add `"crons": [{ "path": "/api/cron/gmail-sync", "schedule": "*/5 * * * *" }]`), `src/lib/inboxes/connect.ts` (add the `syncInboxNow` action)
- Test: `tests/unit/gmail-parse.test.ts`, `tests/unit/gmail-sync.test.ts`, `tests/unit/public-paths.test.ts`

**Interfaces:**
- Consumes: Task 3 `recordEvents` and `LedgerInput`; Task 4 `googleApi`, `GmailMeta`, `GoogleAuthError` and `decryptToken`; Task 2 `parseAddressList`.
- Produces in `parse.ts`:
  ```ts
  export function messageToInputs(m: GmailMeta, ctx: { inboxId: string; inboxEmail: string; userId: string; ownDomains: string[] }): LedgerInput[];
  ```
  - **Sent** (`labelIds` has `SENT`): one `sent` per To, Cc and Bcc recipient that is not on an own domain. Dedupe key `gmail:<inboxId>:<id>:<email>`.
  - **Bounce:**
    - Detected when `from` matches `mailer-daemon@` or `postmaster@`, the subject contains "Delivery Status Notification (Failure)" or "Undeliverable", and `x-failed-recipients` is present.
    - Produces one `bounced` per failed recipient, dedupe key `gmail:<inboxId>:<id>:bounce:<email>`.
    - Delay notices produce nothing.
  - **Other inbound:**
    - Produces one `received` from the From address, dedupe key `gmail:<inboxId>:<id>:from`.
    - Nothing is recorded when the From address is on an own domain, or when the message carries `list-unsubscribe`, a `precedence` of `bulk`, `list` or `junk`, or an `auto-submitted` other than `no`.
  - `occurredAt` is `new Date(internalDate)`.
- Produces in `sync-inbox.ts`:
  ```ts
  export type SyncOutcome = { status: "done" | "more" | "needs_reconnect" | "error"; inserted: number; error?: string };
  export async function syncInbox(agencyId: string, inboxId: string, deadline: number, api?: GoogleApi): Promise<SyncOutcome>;
  ```
  - Order of work:
    1. Backfill sent mail: `in:sent after:<backfill_from as YYYY/MM/DD>`.
    2. Backfill received mail: `-in:sent -in:chats -in:drafts after:...`.
    3. History from the saved `history_id`. The profile `historyId` is captured when the backfill starts, so mail that arrives during the backfill is not missed.
  - Each page of up to 100 ids is fetched with a concurrency of 5. It is then recorded and the cursor saved in one short `withAgency` transaction.
  - If the history feed has expired, one date-based re-list runs since `last_synced_at - 1 day`, then `history_id` resets to the current one.
  - On `GoogleAuthError`: set `needs_reconnect`, keep the cursor, return.
  - Other errors: store `last_sync_error` (message only) and return `error`.
  - Stops between pages when `Date.now() > deadline`.
- Produces in `tick.ts`:
  - `runSyncTick(deadline: number): Promise<{ inboxes: number; inserted: number }>`.
  - Lists enabled agencies through `withSystem` (`select id from agencies where enabled`). For each agency it reads connected inboxes through `withAgency`, the least recently synced first, and syncs them until the deadline.
- Produces `syncInboxNow(inboxId: string)`:
  - Server action with `inbox.manage` permission.
  - Runs `syncInbox` with a 50-second deadline.
- The route:
  - Answers 401 unless `Authorization` is `Bearer ${CRON_SECRET}`.
  - `export const maxDuration = 300`.
  - Runs `runSyncTick(Date.now() + 270_000)` and returns JSON counts.

- [ ] **Step 1: Write failing tests.**
  - `gmail-parse.test.ts`:
    - `a sent message to two recipients and one internal cc gives two sent inputs`;
    - `a failure DSN gives bounced inputs for X-Failed-Recipients`;
    - `a delay DSN gives nothing`;
    - `newsletters and auto-replies give nothing`;
    - `a human reply gives one received input`.
  - `gmail-sync.test.ts` with a fake `GoogleApi` serving 250 sent and 30 received ids:
    - `backfill pages through sent then received and finishes with done`;
    - `a deadline mid-backfill returns more, and the next call resumes without duplicates`: the total event count equals the unique inputs;
    - `history after backfill records new messages`;
    - `expired history falls back to a date re-list`;
    - `invalid_grant marks the inbox needs_reconnect and keeps the cursor`.
  - `public-paths.test.ts`: `/api/cron/gmail-sync is public to the proxy`.
  - Route test: `cron route rejects a missing or wrong secret with 401`.
- [ ] **Step 2: Run `npx vitest run tests/unit/gmail-parse.test.ts tests/unit/gmail-sync.test.ts tests/unit/public-paths.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** the files and config above.
- [ ] **Step 4: Run again.** Expected: PASS. Then run the full `npx vitest run`.
- [ ] **Step 5: Commit** `feat(sync): Gmail backfill and history sync into the ledger, every 5 minutes by cron`.

### Task 7: Inboxes in Settings

**Files:**
- Create: `src/components/settings/inboxes-section.tsx`
- Modify: `src/app/(app)/settings/page.tsx`, `src/app/dev/settings/page.tsx`
- Test: `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: Task 5 `listInboxes`, `disconnectInbox` and `setPrimaryInbox`; Task 6 `syncInboxNow`.
- Produces: `<InboxesSection inboxes={InboxView[]} canConnect={boolean} notice={string | null} />`, rendered first in Settings with `id="inboxes"`.

Content per inbox:
- Email, plus the owner name for managers.
- A status badge: green "Connected", amber "Reconnect needed", or muted "Disconnected".
- "Primary" when it is the primary inbox.
- Domain checks: three lines (SPF, DKIM, DMARC) with a check mark, or amber with the fix text.
- History: "Importing mail history since Nov 24, 2025" while the backfill runs, then "History imported. Last synced 9:05 AM." `last_sync_error` shows in muted red.
- Actions, for those who can manage: Sync now, Make primary, Disconnect (with a confirm), and Reconnect when `needs_reconnect`.
- The page reads `?inbox=connected` or `?inbox_error=` into `notice`.
- Empty state: "Connect the Gmail inbox you send candidate introductions from. RGE reads your sent and received mail so it never emails someone twice by mistake, and sends only what you approve."
- The Connect Gmail button is a plain link to `/api/google/oauth/start`.

- [ ] **Step 1: Write failing e2e tests** in `settings.spec.ts` against `/dev/settings`. Add sample inboxes: one healthy, one needing a reconnect with a failing DKIM, and one with an 80-character email.
  - `inboxes section fits on phone and desktop`, using the existing `overflowReport` at 390 and 1440.
  - `failing DKIM shows its fix text`.
  - `reconnect needed shows a Reconnect link to the OAuth start`.
- [ ] **Step 2: Run `npx playwright test tests/e2e/settings.spec.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** the section and wire it into both pages.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): Inboxes section with connect, domain checks, sync status and disconnect`.

### Task 8: Do-not-contact list and opt-outs

**Files:**
- Create:
  - `src/lib/dnc/actions.ts`, `src/lib/dnc/csv.ts`, `src/lib/dnc/queries.ts`
  - `src/lib/suppressions/actions.ts`, `src/lib/suppressions/queries.ts`
  - `src/components/settings/dnc-section.tsx`
  - `src/components/campaign/opt-outs.tsx`, `src/components/campaign/health-strip.tsx`
- Modify:
  - `src/components/campaign/campaign-sections.tsx`: accepts `optOuts`, `inboxSummary` and `canAdd` props; the Opt-outs and health strip empty states are replaced.
  - `src/app/(app)/campaign/page.tsx`, `src/app/(app)/settings/page.tsx`
  - `src/app/dev/campaign/page.tsx`, `src/app/dev/settings/page.tsx`
- Test: `tests/unit/dnc.test.ts`, `tests/unit/suppressions.test.ts`, `tests/e2e/settings.spec.ts`, `tests/e2e/campaign.spec.ts`

**Interfaces:**
- Consumes: Task 2 `normalizeDomain` and `normalizeEmail`; Task 3 `addSuppression`; Task 1 permissions.
- Produces in `src/lib/dnc/`:
  ```ts
  export type DncInput = { name: string; domains: string[]; aliases: string[]; note?: string | null };
  export function parseDncCsv(text: string): { rows: DncInput[]; errors: { line: number; reason: string }[] }; // headers name, domains, aliases, note; lists split on ; or |
  export async function addDncEntry(input: DncInput): Promise<{ ok: true } | { ok: false; error: string }>;
  export async function removeDncEntry(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  export async function importDncCsv(form: FormData): Promise<{ ok: true; added: number; merged: number; errors: { line: number; reason: string }[] } | { ok: false; error: string }>;
  export async function listDnc(member: Member): Promise<{ id: string; name: string; domains: string[]; aliases: string[]; source: DncSource }[]>;
  ```
  - An entry needs a name and at least one domain or alias.
  - Domains are normalized; invalid ones are reported per line.
  - A CSV row whose normalized name matches an existing entry merges its domains and aliases into that entry (`merged`). It never duplicates.
  - The file must be under 1 MB.
- Produces in `src/lib/suppressions/`:
  - `addOptOut(email: string, note: string): Promise<{ ok: true; result: "added" | "already" } | { ok: false; error: string }>`: reason `manual`, source `manual`, permission `suppression.add`.
  - `listSuppressions(member: Member, q?: string): Promise<{ email: string; reason: SuppressionReason; source: LedgerSource; createdAt: Date }[]>`: newest first, filtered by substring, at most 500 rows.
- UI:
  - Settings "Do-not-contact companies" section:
    - Lists entries with their domains and aliases.
    - Managers see an Add form (name, domains, aliases), Remove (with a confirm) and "Upload CSV", with a one-line format hint and the per-line errors after upload.
    - Recruiters see the list read-only.
    - Help line: "RGE never researches or emails these companies, their domains or their aliases."
  - Campaign "Opt-outs and bounces":
    - A count and a search box.
    - The list shows email, reason ("Opted out", "Bounced", "Added by hand") and date.
    - "Add opt-out" (email plus optional note).
    - Footer: "People on this list are never emailed again. It cannot be undone in RGE."
  - Campaign health strip:
    - "N inboxes connected", plus an amber "N need reconnecting" and "Importing mail history" while any backfill runs.
    - With no inboxes: the existing empty text plus a link to `/settings#inboxes`.

- [ ] **Step 1: Write failing tests.**
  - `dnc.test.ts`:
    - `parseDncCsv reads lists, reports a row with no domain or alias, and rejects a bad domain`;
    - `a CSV row matching an existing name merges instead of duplicating`;
    - `a recruiter cannot add or remove entries`;
    - `removing an entry unblocks it for doNotContactMatch`.
  - `suppressions.test.ts`:
    - `any member can add an opt-out, a second add reports already`;
    - `an invalid email is refused`;
    - `there is no remove action`: assert that `src/lib/suppressions/actions.ts` exports exactly `addOptOut`.
  - e2e:
    - `do-not-contact section fits` and `opt-outs list fits`, at 390 and 1440, with long sample data;
    - `search filters the opt-out list`.
- [ ] **Step 2: Run the new unit and e2e tests.** Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: do-not-contact list with CSV upload, permanent opt-out list and inbox health strip`.

### Task 9: WR history import

**Files:**
- Create:
  - `src/lib/history-import/csv.ts`, `src/lib/history-import/parsers.ts`, `src/lib/history-import/actions.ts`
  - `src/components/settings/import-section.tsx`
- Modify: `src/app/(app)/settings/page.tsx`, `src/app/dev/settings/page.tsx`
- Test: `tests/unit/history-import.test.ts`, `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: Task 3 `recordEvents` and `addSuppression`; Task 8 `parseDncCsv` and the DNC merge logic (factor the merge into `src/lib/dnc/queries.ts` as `upsertDncEntries(tx, agencyId, rows, source, createdBy)` and reuse it).
- Produces in `csv.ts`:
  - `parseCsv(text: string): string[][]`: RFC 4180, with quoted fields, embedded commas and newlines, CRLF and a BOM.
  - `parseWallTime(s: string, timeZone: string): Date | null`. It accepts:
    - ISO with an offset;
    - `YYYY-MM-DD`;
    - `YYYY-MM-DD HH:mm[:ss]`;
    - `M/D/YYYY[ h:mm AM]`.
    A value with no offset is read in `timeZone`. Anything else gives null.
- Produces in `parsers.ts`:
  ```ts
  export type ImportKind = "suppression" | "sends" | "followups" | "outcomes" | "dnc";
  export type ParsedImport = { kind: ImportKind; inputs: LedgerInput[]; suppressions: { email: string; reason: SuppressionReason }[];
    dnc: DncInput[]; skipped: { line: number; reason: string }[]; rows: number };
  export function parseImport(kind: ImportKind, filename: string, text: string, timeZone: string): ParsedImport;
  ```
  Header names are matched case-insensitively and extra columns are ignored.

  | Kind | Columns read | Produces | Dedupe key |
  |---|---|---|---|
  | `suppression` | `.csv`: `email` or `recipient`, optional `reason`; `.txt`: every email found on each line | A suppression. The reason is `bounced` if it contains "bounce", else `opted_out` | |
  | `sends` (WR `mpc-send-*.csv`) | `recipient`, `time`, `status`, `message_id`, `company` | `sent`, for rows whose status is empty or `sent` | `import:sent:<message_id>`, or `import:sent:<email>:<iso time>` with no id |
  | `followups` (`mpc-followups.csv`) | `recipient`, `time`, `status`, `followup_message_id` | `follow_up_sent`, for sent rows | `import:fu:<followup_message_id or email:time>` |
  | `outcomes` (`sales-outcomes.csv`) | `date`, `firm`, `contact`, `type` | Type `signed_*` gives `agreement_signed` with `companyName = firm` (and email when `contact` is one). Type `mpc_pitch_sent` with an email `contact` gives `sent`. Other types are skipped with "type not imported" | `import:outcome:<line hash>` |
  | `dnc` | Task 8 format | Do-not-contact entries | |

- Produces in `actions.ts`, both requiring `history.import` (managers):
  - `previewImport(form: FormData): Promise<{ ok: true; summary: ImportSummary } | { ok: false; error: string }>`
  - `applyImport(form: FormData): Promise<{ ok: true; summary: ImportSummary } | { ok: false; error: string }>`
  - `ImportSummary = { rows: number; newEvents: number; newSuppressions: number; dncAdded: number; dncMerged: number; skipped: { line: number; reason: string }[] }`.
  - The preview runs the full apply inside `withAgency` and rolls back by throwing a sentinel. Its counts are therefore exact, including duplicates already present.
  - Files must be under 5 MB. `kind` is a form field.
- UI: a Settings section "Import history", shown to managers.
  - Controls: pick the kind, choose a file, and Preview.
  - The preview shows the counts and the first 20 skipped rows with reasons. Then the Import button appears.
  - Help line: "Importing the same file again adds nothing new."

- [ ] **Step 1: Write failing tests** in `history-import.test.ts`, with made-up `example.com` fixtures inline.
  - CSV parsing:
    - `parseCsv handles quotes, commas, newlines in fields, CRLF and BOM`.
    - `parseWallTime reads "2026-11-18 09:14" as 9:14 AM Phoenix (16:14Z)`.
  - Row handling:
    - `bad dates skip the row with a reason`.
    - `send log imports sent rows only and skips failed and held`.
    - `re-importing the same send log inserts nothing`: apply twice, and the second `newEvents` is 0.
  - Each kind:
    - `suppression txt pulls every email on each line`.
    - `outcomes: signed_fee_agreement marks the firm a client; unknown types are skipped with a reason`.
  - Preview and permissions:
    - `preview writes nothing`: count the ledger rows before and after.
    - `a recruiter cannot preview or apply`.
  - e2e: `import section fits on phone and desktop` (in `settings.spec.ts`).
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run again.** Expected: PASS. Then run the full `npx vitest run` and `npx playwright test`.
- [ ] **Step 5: Commit** `feat(import): preview and import WR send logs, follow-ups, outcomes, suppressions and do-not-contact lists`.

### Task 10: Deploy the code (no inboxes connected yet)

**Files:**
- Modify: `README.md` (new sections "Gmail connection (Google OAuth app)" and "Background sync"), `docs/superpowers/plans/2026-11-24-rge-plan-2-ledger-and-inboxes.md` (record the outcome)

Founder decision, 2026-11-24: no inbox is connected and no history is imported while the bots are still running. The code ships now, and the Connect Gmail button says "Gmail connection is not set up yet" until cutover.

- [ ] **Step 1: Write the README sections.**
  - The Google OAuth app setup steps listed under Cutover below.
  - The env vars.
  - How the cron and "Sync now" work.
- [ ] **Step 2: Set the env vars on Vercel.** For production and preview, set `RGE_TOKEN_KEY` and `CRON_SECRET`, both sensitive and freshly generated. Copy them to `.env.local`. The Google client ID and secret wait for cutover.
- [ ] **Step 3: Check the Vercel plan allows the 5-minute cron.** If the team is on Hobby, change the schedule to daily (`0 12 * * *`) and say so.
- [ ] **Step 4: Migrate production.** Run `node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs migrate`. Verify the 9 tables have RLS enabled and forced, and that `has_table_privilege('rge_app', 'suppressions', 'DELETE')` is false.
- [ ] **Step 5: Push and confirm the deploy.**
  - Push `claude/rge-repository-0nxb3b` and confirm the deployment is READY.
  - Confirm that `GET /api/cron/gmail-sync` without the secret returns 401.
  - Confirm that a cron run with no connected inboxes returns zero counts and logs no errors.
- [ ] **Step 6: Final whole-branch review** (superpowers:requesting-code-review). Fix the findings, then commit `docs: record Plan 2 deploy`.

## Cutover (later: once, right before RGE's first real send, after Plan 5 is built)

Done once, so nothing is imported twice while the bots keep running.

1. **Founder: create the internal Google OAuth app.**
   1. Open Google Cloud Console signed in as a Workspace admin, and create a project "RGE".
   2. Enable the Gmail API.
   3. Set up the OAuth consent screen with User type **Internal**, app name "RGE", and the two Gmail scopes.
   4. Create a Web application client with these redirect URIs:
      - `https://app.whittonrecruiting.com/api/google/oauth/callback`
      - `http://localhost:3000/api/google/oauth/callback`
   5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on Vercel.
2. **Stop the bots' sending.**
3. **Founder: connect the inboxes.** Connect `ryan@`, and every other inbox used for MPC outreach, in Settings. Let the sync import history until each inbox shows "History imported". The agent then checks the ledger counts by type with a read-only SQL query that prints no addresses.
4. **Import WR's final bot files.** The founder copies them into `private/import/`, then they are previewed and imported in this order:
   1. suppression lists;
   2. do-not-contact (the marketplace clients);
   3. send logs;
   4. follow-ups;
   5. outcomes.

   Record the counts (numbers only) here.
5. **Then the first RGE send.** Plan 5 owns the send.
