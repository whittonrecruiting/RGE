# RGE Plan 3: Research Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every send day at 5:00 AM agency time, RGE researches who needs each active MPC. It finds advertised openings and speculative targets, runs the checks in the spec's order (free checks before any paid lookup), finds the decision maker and a work email through the agency's own Apollo key, assigns an email tier, then scores each prospect and sorts it into Drop, Needs research, Flagged or Clean. Each recruiter gets only as many prospects as their inboxes can send. The run records every step in an audit log and meters AI, web search and Apollo usage per recruiter.

**Architecture:**
- **Work queue.** A daily run is a row in `research_runs`, with one `research_run_mpcs` row per MPC and one `research_candidates` row per company under consideration.
  - A Vercel Cron route (`/api/cron/research`, every 5 minutes) runs a deadline-bounded tick.
  - Each tick plans runs that are due, then claims work with leases (`FOR UPDATE SKIP LOCKED`). Up to 3 items run in parallel.
- **Candidate pipeline with checkpoints.** Each candidate runs as one pipeline.
  - Every external result (ATS fetch, Apollo search, Apollo match, AI pick) is saved to `research_candidates.state` before the next step runs.
  - A retried candidate never pays for the same lookup twice.
- **Pure rules.** Tiers, hard filters, flags, buckets, scores, allocation and overlap rules are pure functions in `src/lib/research/rules.ts` and `allocate.ts`. They are tested exhaustively, and the pipeline only gathers their inputs.
- **External calls.** Apollo and the four ATS boards use plain `fetch` behind interfaces with test overrides, as `GoogleApi` does in Plan 2. AI steps go through the existing `GenerateFn`, which now takes a model.
  - Discovery and fit reasoning use Sonnet with web search.
  - Picking the decision maker and the web contact fallback use Haiku.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle ORM + Neon Postgres (PGlite in tests), AI SDK 7 with `@ai-sdk/anthropic` (web search tool `webSearch_20260318`), Vercel Cron, Vitest, Playwright. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-20-rge-v1-design.md`, sections 7 (all) and 23, plus the research parts of 14 (Campaign research numbers, errors, health strip), 16 (Integrations: data provider), 17 (Apollo, web search and AI), 18 (Posting, Prospect, ResearchRun, ResearchLog, IntegrationConnection), 21 and 22. Roadmap: `docs/superpowers/plans/2026-11-21-rge-roadmap.md`.

## Global Constraints

- Never commit candidate names, prospect or client contacts, email addresses, resumes, compensation, Loxo or Paraform exports, or any credential.
  - Fixtures use made-up firms on `example.com`, `example.org` or `example.net`, and made-up people.
  - ATS and Apollo fixtures are hand-written JSON in `tests/fixtures/research/`, never captured from real accounts.
- "Nothing paid until free checks pass."
  - The order is fixed: company-level exclusions, repeat check, decline check, MPC hard filters, decision maker search (free), paid email lookup, email tier, score and sort.
  - A test asserts that a candidate failing any of the first four makes zero Apollo calls of any kind, so no search runs and no credits are spent.
- "Research only fills capacity, so no credits are spent on prospects that cannot be sent."
  - The target is 10 prospects per MPC per day.
  - Capacity is computed per recruiter: their connected inboxes × `settings.newPitchCapPerInbox`. Only inboxes whose owner is an active member count. Zero capacity means nothing paid runs.
- Apollo use is limited to:
  - people search `POST https://api.apollo.io/api/v1/mixed_people/api_search` (0 credits);
  - people match `POST https://api.apollo.io/api/v1/people/match`, sent with `reveal_personal_emails=false`, `reveal_phone_number=false`, `run_waterfall_email=false`, `run_waterfall_phone=false`;
  - key check `GET https://api.apollo.io/api/v1/auth/health` (`{healthy, is_logged_in}`).
  - Auth is the `x-api-key` header. There is no phone lookup, no waterfall, no Apollo sequences, and personal emails are never accepted.
- "Work email for prospects." A contact email must be on the company's domain or a subdomain of it. A free-mail address, or one on another domain, is tier T6.
- Email tiers are verbatim from the spec:
  - T1: verified, not catch-all.
  - T2: verified, catch-all domain.
  - T3: independently validated.
  - T4: published on the company site.
  - T5: found in the agency's own sent mail.
  - T6: unverified.
  - "Clean draft requires T1, or T2 plus T3. T4 and T5 produce a flagged draft. T6 goes to Needs research. Guessed patterns are never shown as verified."
- Score ranges are verbatim: specialty 0 to 3, seniority 0 to 2, location 0 to 2, pay 0 to 2 (unknown is 1), hiring signal 0 to 2, decision-maker quality 0 to 2, email tier 0 to 2. Clean prospects are ordered advertised first, then by score.
- Repeat rules are read from the agency-wide ledger across every MPC and recruiter, exactly as written in spec section 7 "Repeat rules, precisely". The repeat window is `settings.repeatWindowDays` (WR default 60). The stale posting age is `settings.stalePostingDays` (default 90).
- "Speculative targets ... each needs a specific candidate-based reason, never just 'same industry.'" Every prospect stores a non-empty `whyCompany` sentence.
- "Every search, ATS call, data-provider call and AI research step is logged with inputs and outputs per run, viewable by Owners and Admins."
- "OAuth tokens and API keys encrypted at rest; never logged."
  - The Apollo key is encrypted with the existing `encryptToken` (`RGE_TOKEN_KEY`).
  - The key never appears in a log row, an error message, a returned value or the client bundle. A test greps `research_log` for it.
- "Agency data isolated at the database level." Every new table goes into `src/db/rls.sql` with `agency_isolation`, ENABLE and FORCE, and is added to `tests/unit/db/isolation.test.ts`.
- Running cost:
  - The target is at most about $50 per active recruiter per month, with a hard ceiling of $100.
  - Research stops paid AI steps for a recruiter's MPCs once that recruiter's month-to-date estimated AI and web search cost reaches `RESEARCH_COST_CEILING_USD = 100`.
  - The strongest model is used only for fit reasoning (discovery). Bulk steps use Haiku.
- Page content, posting text and AI output are data, never instructions. Every AI prompt says so, and code re-checks every rule the AI could get wrong.
- UI copy is plain, with no em dashes, emojis or hype. Every new screen is checked at 390 px and 1440 px with no horizontal scroll (`tests/e2e/fit.ts`).
- Every server action calls `requireMember()` itself and checks `can(...)`. All database access goes through `withAgency` or `withSystem`.

## Calls made in this plan (check these)

1. **Catch-all detection.**
   - Apollo's documented match response has no catch-all field. The tier mapper reads `email_status === "verified"` as T1 unless the response carries a field whose name contains `catchall`, `catch_all` or `accept_all` set to true, which makes it T2.
   - Any other status, including extrapolated emails, is T6.
   - Raw `email_status` values are kept in the audit log so WR can check them in the first weeks.
   - Cost if wrong: a catch-all address could show as clean. The fix is one function.
2. **No second validator in v1.** T3 ("independently validated") has no provider yet, so T2 alone produces a flagged draft. Adding a validator later changes one input to `emailTier`.
3. **Capacity ignores warm-up and overflow for now.** Plan 3 uses `newPitchCapPerInbox` per connected inbox. Plan 5 replaces `capacityByOwner` with the warm-up-aware cap minus approved pitches carried over. Nothing runs before cutover anyway, because no inbox is connected.
4. **Overlap is decided after discovery, without fail-over.**
   - When two MPCs list the same company in one run, the MPC with the higher `overlapPriority` takes it. A tie goes to the older MPC.
   - The loser drops it for that day with "taken by a higher-priority MPC today", even if the winner later rejects it.
5. **Decision maker search uses titles, not names.** Apollo's free search returns titles and obfuscated last names only.
   - Discovery suggests decision-maker titles per company. Apollo searches those titles at the company's domain in the MPC's location, then falls back to senior titles.
   - Haiku picks one person by the agency's priority rules.
   - A web search fallback (Haiku, at most 3 searches) runs only when Apollo returns nobody. It can produce a T4 email when the company site publishes one.
6. **Stale or unconfirmed postings go to Needs research.** The spec also allows turning the prospect speculative. Needs research is the conservative choice, because it can never lead to telling a firm it is hiring when it is not.
7. **Existing clients are dropped as prospects** (reason "already a client"). Recruiters pitch clients directly.
8. **"Open question on the MPC"** means the MPC is missing years of experience or a pay target. Every prospect for that MPC is flagged until both are filled.
9. **Exhausted** means three daily runs in a row found no new qualified company for an MPC that had a target. Saving a change to its location, target cities, specialties, work mode or employer type clears it.
10. **Preview research.** An MPC's owner, or a manager, can run a preview for one MPC from the MPC page. It does discovery, free checks and the free decision maker search, but no paid email lookup and no capacity limit. Its prospects are never drafted.
    - Limits: once per MPC per day, and 10 previews per agency per day.
    - This lets WR see research working before cutover without spending Apollo credits.
11. **The research start time is a constant, 05:00 agency time** ("default 5:00 AM"). The setting can be exposed later. A run stops starting new work when the agency's send window closes that day.
12. **Overqualified** means the MPC's years of experience exceed a posting's stated maximum by more than `OVERQUALIFIED_MARGIN_YEARS = 5`.
13. **The firm universe is keyed by segment.** A segment is one specialty and one region, for example `litigation|phoenix az`. A company is rejected in a segment only for company-level reasons: do-not-contact, recruiting firm, existing client, or location. MPC-specific drops (pay, overqualified, employer type) leave it "considered" for other MPCs.

## Review Focus

1. **The candidate's own employer, or an MPC excluded company, suggested under a slightly different name or by domain.**
   - Expected: dropped, never researched further, and no Apollo calls made.
   - Owned by Task 9. Test: `drops a company matching a confidential restriction or excluded company by name or domain`.
2. **The Apollo key revoked or out of credits in the middle of a run.**
   - Expected: the connection is marked failing and remaining candidates go to Needs research with "Data provider key is failing". The run finishes without a retry storm, and Owners see a banner.
   - Owned by Task 9 and Task 10. Test: `an unauthorized Apollo response marks the key failing and stops further Apollo calls in the run`.
3. **Two cron ticks running at once, or a tick dying in the middle of a candidate.**
   - Expected: no candidate is processed twice, and no paid match is repeated after a resume.
   - Owned by Task 10. Tests: `two concurrent ticks never claim the same candidate` and `a resumed candidate does not repeat a saved Apollo match`.
4. **Agency time zones and send days.**
   - Expected: a run starts at or after 05:00 local only on a send day, once per local date, including the daylight saving change for an agency in `America/New_York`.
   - Owned by Task 10. Test: `starts one daily run per local send day at 05:00 local`.
5. **Malformed or adversarial AI output.** Examples: scores like 9, free-mail or malformed domains, the same company twice, an em dash in `whyCompany`, instructions copied from a page.
   - Expected: scores are clamped and bad rows are dropped before they reach the pipeline.
   - Owned by Task 7. Test: `cleanDiscovered clamps scores and drops bad domains, duplicates and empty reasons`.

---

## File Structure

```
drizzle/0017_research.sql                 generated: enums, tables, new columns
drizzle/0018_rls_research.sql             custom: RLS and grants (appended to src/db/rls.sql)
src/db/schema.ts                          + integrationConnections, researchRuns, researchRunMpcs,
                                            researchCandidates, postings, prospects, firmUniverse,
                                            researchLog, providerUsage; new columns on mpcs,
                                            companies, contacts; aiPurpose values
src/lib/permissions.ts                    + integration.manage, research.audit, research.preview, usage.view
src/lib/ai/models.ts                      MODELS table, GenerateFn takes model, price table, costUsd()
src/lib/ai/usage.ts                       recordSystemAiUsage(), recruiterMonthCostUsd()
src/lib/apollo/client.ts                  ApolloApi interface, fetch implementation, test override
src/lib/apollo/connection.ts              load and decrypt the key, mark failing (server only)
src/lib/apollo/actions.ts                 "use server": saveApolloKey, testApolloKey, removeApolloKey
src/lib/research/types.ts                 shared types and codes
src/lib/research/rules.ts                 pure: tiers, hard filters, classify, score, order, staleness
src/lib/research/allocate.ts              pure: allocate(), assignOverlaps(); capacityByOwner() query
src/lib/research/segments.ts              pure: segmentsFor(); loadKnownFirms() query
src/lib/research/ats/*.ts                 detectAts(), greenhouse, lever, ashby, workday fetchers
src/lib/research/postings.ts              checkPosting(), upsertPosting()
src/lib/research/discover.ts              discoverCompanies(), cleanDiscovered()
src/lib/research/contact.ts               findDecisionMaker(), lookupEmail()
src/lib/research/log.ts                   logStep(), redact and truncate
src/lib/research/pipeline.ts              processCandidate()
src/lib/research/run.ts                   ensureDailyRun(), planRun(), runDiscovery(), finishRun()
src/lib/research/tick.ts                  runResearchTick()
src/lib/research/preview-action.ts        "use server": startPreviewRun()
src/lib/research/queries.ts               views for the screens
src/app/api/cron/research/route.ts
src/app/(app)/campaign/research/page.tsx
src/app/(app)/campaign/research/log/page.tsx
src/components/research/*.tsx             run summary, MPC table, prospect list, needs research list,
                                            audit log, usage card, MPC research card, Apollo settings
src/app/dev/research/page.tsx             e2e fixture page
vercel.json                               + research cron
```

---

### Task 1: Schema, migrations, isolation and permissions

**Files:**
- Modify: `src/db/schema.ts`, `src/lib/permissions.ts`, `src/db/rls.sql`, `tests/unit/db/isolation.test.ts`, `tests/unit/permissions.test.ts`
- Create: `drizzle/0017_research.sql` (generated), `drizzle/0018_rls_research.sql` (custom), `tests/unit/db/research-grants.test.ts`

**Interfaces:**
- Produces enums:
  - `prospectBucket` = `drop | needs_research | flagged | clean`.
  - `prospectKind` = `advertised | speculative`.
  - `emailTier` = `T1 … T6`.
  - `researchRunKind` = `daily | preview`.
  - `researchRunStatus` = `running | done | stopped | failed`.
  - `runMpcStatus` = `pending | discovering | qualifying | done`.
  - `candidateStatus` = `queued | done | parked | failed`.
  - `universeStatus` = `considered | pitched | rejected`.
  - `integrationStatus` = `ok | failing`.
  - `aiPurpose` gains `research_discovery`, `research_contact`.
- Produces tables. Every table has `id`, `agency_id`, same-agency foreign keys and timestamps, like Plan 2.
  - `integration_connections`: `provider text`, `secret_enc text`, `secret_hint text`, `status`, `last_error text`, `last_checked_at`, `connected_by uuid` (member).
    - Unique on (agency_id, provider).
  - `research_runs`: `kind`, `run_date date` (agency local), `status`, `capacity_total int`, `paid_lookups boolean`, `started_by uuid null` (member, preview only), `stop_reason text`, `started_at`, `finished_at`, `summary jsonb`.
    - Partial unique index on (agency_id, run_date) WHERE kind = 'daily'.
  - `research_run_mpcs`: `run_id`, `mpc_id`, `owner_user_id`, `target int`, `found int default 0`, `status`, `shortfall_reason text`, `discovery_note text`, `leased_until`, `attempts smallint default 0`.
    - Unique on (run_id, mpc_id).
  - `research_candidates`: `run_id`, `run_mpc_id`, `mpc_id`, `company_name`, `domain`, `company_id null`, `kind`, `discovered jsonb` (the cleaned discovery row), `state jsonb default {}` (checkpoints), `status`, `outcome text`, `leased_until`, `attempts smallint default 0`, `last_error text`.
    - Unique on (run_id, mpc_id, domain).
  - `postings`: `company_id`, `url`, `title`, `source` (`greenhouse | lever | ashby | workday | company_site | aggregator`), `ats_job_id`, `first_published_at`, `source_updated_at`, `last_seen_live_at`, `live boolean`, `salary_min int`, `salary_max int`.
    - Unique on (agency_id, url).
  - `prospects`: `run_id`, `mpc_id`, `company_id`, `contact_id null`, `posting_id null`, `kind`, `bucket`, `score jsonb`, `score_total smallint`, `email_tier null`, `codes text[]` (drop, needs-research and flag codes), `infos text[]`, `why_company text not null`, `why_person text`, `status text default 'open'` (Plan 4 sets drafted or dismissed).
    - Unique on (run_id, mpc_id, company_id).
  - `firm_universe`: `segment text`, `company_id`, `status`, `reason text`, `last_mpc_id`.
    - Unique on (agency_id, segment, company_id).
  - `research_log`: `run_id`, `mpc_id null`, `candidate_id null`, `step text`, `input jsonb`, `output jsonb`, `error text`, `created_at`.
  - `provider_usage`: `user_id` (member), `run_id null`, `provider text`, `operation text` (`search | match`), `credits int`, `created_at`.
- New columns:
  - `mpcs.research_empty_streak smallint default 0`, `mpcs.exhausted_at timestamptz null`.
  - `companies.profile jsonb null`, `companies.profiled_at timestamptz null` (cached company research).
  - `contacts.apollo_person_id text null`.
- Grants for `rge_app`:
  - SELECT, INSERT and UPDATE on every new table, except `research_log` and `provider_usage`, which get SELECT and INSERT only (append-only).
  - `integration_connections` also gets DELETE.
- Permissions:
  - `integration.manage`, `research.audit` and `usage.view` are managers only.
  - `research.preview` is the MPC owner or a manager. It takes `{ ownerUserId }` and fails closed.

- [ ] **Step 1: Write the failing tests**
  - In `isolation.test.ts`, add the nine tables to the list. Agency B cannot read or write agency A rows.
  - In `research-grants.test.ts`:
    - `research_log and provider_usage reject UPDATE and DELETE for rge_app`.
    - `daily runs are unique per agency and local date, previews are not`.
    - `rls.sql equals the concatenation of the rls migrations` (the existing test still passes).
  - In `permissions.test.ts`:
    - A recruiter can `research.preview` their own MPC and not a teammate's.
    - Only managers can `integration.manage`, `research.audit` and `usage.view`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/db tests/unit/permissions.test.ts`. Expected: FAIL (tables missing).
- [ ] **Step 3: Add the schema.** Run `npm run db:generate` to create `0017`. Write `0018_rls_research.sql` in the Plan 2 style and append it to `src/db/rls.sql`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run `npm run typecheck` and `npm test`. Expected: all green.
- [ ] **Step 5: Commit** `feat(research): schema, isolation and permissions for the research engine`.

### Task 2: Model routing, cost estimate and metering for system steps

**Files:**
- Modify: `src/lib/ai/models.ts`, `src/lib/ai/usage.ts`, `tests/unit/ai-usage.test.ts`, callers of `recordAiUsage` (model now recorded per call)
- Test: `tests/unit/ai-cost.test.ts`

**Interfaces:**
- Produces in `models.ts`:
  - `MODELS = { extract: "claude-sonnet-5-5", discovery: "claude-sonnet-5-5", bulk: "claude-haiku-5-5" } as const`; `type ModelId = (typeof MODELS)[keyof typeof MODELS]`.
  - `GenerateFn` args gain `model?: ModelId`. It defaults to `MODELS.extract`, so existing callers are unchanged.
  - `PRICES: Record<ModelId, { inputPerMTok: number; outputPerMTok: number }>`. The values are copied from the Anthropic list prices in the `claude-api` skill at implementation time.
  - `WEB_SEARCH_USD_PER_1000 = 10`.
  - `costUsd(model: ModelId, usage: AiUsage, prices = PRICES): number`.
- Produces in `usage.ts`:
  - `recordSystemAiUsage(tx: Tx, row: { agencyId: string; userId: string; purpose: AiPurpose; model: ModelId; usage: AiUsage }): Promise<void>`.
  - `recruiterMonthCostUsd(tx: Tx, userId: string, now: Date, timeZone: string): Promise<number>` sums `costUsd` over that user's `ai_usage` rows in the current local calendar month. Interactive calls count too.
  - `RESEARCH_COST_CEILING_USD = 100`.
  - `AiPurpose` gains `"research_discovery" | "research_contact"`.
  - `recordAiUsage` records the model actually used.

- [ ] **Step 1: Write the failing tests**
  - `costUsd prices input, output and web searches` uses injected prices `{inputPerMTok: 3, outputPerMTok: 15}` and usage `{inputTokens: 1_000_000, outputTokens: 100_000, webSearches: 5}`. It asserts 4.55.
  - `recruiterMonthCostUsd counts only this user's rows in the local month`:
    - Rows: one on the last day of the previous month at 23:30 Phoenix time, one in this month, and one belonging to another user.
    - Only the one row counts.
  - `defaultGenerate uses the model it is given`: the stubbed provider receives `claude-haiku-5-5` when `model: MODELS.bulk`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/ai-cost.test.ts tests/unit/ai-usage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the code above. For the model-selection test, `defaultGenerate` takes the model from the args and passes it to `anthropic(model)`.
- [ ] **Step 4: Run** the tests, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): model routing, cost estimate and system usage metering`.

### Task 3: Apollo client and key connection

**Files:**
- Create: `src/lib/apollo/client.ts`, `src/lib/apollo/connection.ts`, `src/lib/apollo/actions.ts`, `src/components/settings/integrations-section.tsx`, `tests/fixtures/research/apollo-*.json`
- Modify: `src/app/(app)/settings/page.tsx`, `src/app/dev/settings/page.tsx`, `tests/e2e/settings.spec.ts`
- Test: `tests/unit/apollo-client.test.ts`, `tests/unit/apollo-actions.test.ts`

**Interfaces:**
- Produces in `client.ts`:
  - `type ApolloPerson = { id: string; firstName: string; lastNameObfuscated: string | null; title: string | null }`.
  - `type ApolloMatch = { id: string; firstName: string | null; lastName: string | null; title: string | null; email: string | null; emailStatus: string | null; catchAll: boolean | null; orgDomain: string | null; city: string | null; state: string | null }`.
  - `class ApolloError extends Error { kind: "unauthorized" | "rate_limited" | "server" | "bad_request"; status: number }`. The message never contains the key.
  - `interface ApolloApi`:
    - `authHealth(key: string): Promise<boolean>`
    - `searchPeople(key: string, q: { domain: string; titles: string[]; seniorities: string[]; locations: string[]; perPage: number }): Promise<ApolloPerson[]>`
    - `matchPerson(key: string, by: { id: string } | { name: string; domain: string }): Promise<ApolloMatch | null>`
  - `apolloApi(): ApolloApi` and `setTestApolloApi(api | undefined)` (test only, guarded like `setTestGenerate`).
  - `parseMatch(raw: unknown): ApolloMatch | null` (exported for tests). `catchAll` is true when any key of the person object containing `catchall`, `catch_all` or `accept_all` (case-insensitive) is `true`. It is false when such a key is `false`, and null when there is none.
- Produces in `connection.ts`:
  - `loadApolloKey(tx: Tx): Promise<{ key: string; status: "ok" | "failing" } | null>`.
  - `markApolloFailing(tx: Tx, reason: string): Promise<void>`.
  - `markApolloOk(tx: Tx): Promise<void>`.
- Produces in `actions.ts` (all require `integration.manage`):
  - `saveApolloKey(key: string): Promise<{ ok: true } | { ok: false; error: string }>`: trims the key, calls `authHealth` first, then stores it encrypted with `secret_hint` set to the last 4 characters.
  - `testApolloKey()`
  - `removeApolloKey()`
- Produces a settings view: `getApolloConnectionView(member): Promise<{ connected: boolean; hint: string | null; status: "ok" | "failing" | null; lastError: string | null }>`.

- [ ] **Step 1: Write the failing tests**
  - `searchPeople sends x-api-key and the documented body`. It asserts:
    - the URL is `https://api.apollo.io/api/v1/mixed_people/api_search`;
    - the header is `x-api-key`;
    - the body has `q_organization_domains_list`, `person_titles`, `person_seniorities`, `person_locations` and `per_page`;
    - there is no Authorization header.
  - `matchPerson never reveals personal email or phone` asserts that all four reveal and waterfall flags are false.
  - `401 becomes ApolloError unauthorized without the key in the message`.
  - `429 becomes rate_limited`.
  - `requests time out after 30 seconds`.
  - `parseMatch reads catch-all flags and leaves null when absent` uses the three fixtures.
  - `saveApolloKey rejects a key that fails auth health and stores nothing`.
  - `a saved key is encrypted and never returned`: the view shows only `hint`, and the stored `secret_enc` is not equal to the key.
  - `recruiters cannot save keys`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/apollo-client.test.ts tests/unit/apollo-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the client with `fetch` and `AbortSignal.timeout(30_000)`. Retry once on 5xx with a drained body. Never retry 4xx.
  - Before writing `parseMatch`, confirm the response field names against `https://docs.apollo.io/reference/people-enrichment`. Keep the field reads in that one function.
  - Add the Settings "Integrations" section (Owner and Admin):
    - A password-type input labeled "Apollo API key".
    - Save, Test and Remove buttons.
    - Status line: "Connected, key ending 1234", or "Not working: <reason>. Research is using free checks only until this is fixed."
    - Help text: "RGE uses your Apollo key for people search (free) and work email lookups (uses your Apollo credits). It never looks up phones or personal emails."
- [ ] **Step 4: Run** the unit tests and `npx playwright test tests/e2e/settings.spec.ts`. Extend the spec so the Integrations section renders and fits at 390 px and 1440 px. Expected: PASS.
- [ ] **Step 5: Commit** `feat(apollo): client and encrypted key connection in Settings`.

### Task 4: Research rules (pure)

**Files:**
- Create: `src/lib/research/types.ts`, `src/lib/research/rules.ts`
- Test: `tests/unit/research-rules.test.ts`

**Interfaces:**
- Produces in `types.ts`:
  - `EmailTier`, `Bucket` and `ProspectKind`, matching the enums.
  - `DropCode`: `"do_not_contact" | "recruiting_firm" | "mpc_excluded_company" | "confidential_employer" | "existing_client" | "already_pitched_for_mpc" | "rejected_before" | "taken_by_higher_priority" | "location" | "license_region" | "employer_type" | "overqualified" | "pay_below_floor" | "suppressed" | "freemail_domain"`.
  - `NeedsCode`: `"no_decision_maker" | "no_verified_email" | "posting_unconfirmed" | "posting_stale" | "posting_gone" | "fit_unestablished" | "provider_failing" | "preview_no_lookup" | "budget_reached"`.
  - `FlagCode`: `"same_contact_recent" | "company_contact_recent" | "company_declined" | "third_pitch" | "no_recruiters" | "no_consent" | "weak_email_tier" | "mpc_open_question"`.
  - `InfoCode`: `"large_firm_other_contact" | "pay_below_floor_flag_only"`.
  - `CODE_TEXT: Record<DropCode | NeedsCode | FlagCode | InfoCode, string>`. This is plain copy shown in the UI, for example `company_contact_recent: "Someone else at this company was emailed in the repeat window"`.
  - `type Score = { specialty: number; seniority: number; location: number; pay: number; hiringSignal: number; decisionMaker: number; emailTier: number; total: number }`.
- Produces in `rules.ts`:
  - `emailTier(i: { apolloStatus: string | null; catchAll: boolean | null; onCompanyDomain: boolean; independentlyValid: boolean; publishedOnSite: boolean; inAgencyMail: boolean }): EmailTier`.
    - Not on the company domain → T6.
    - `apolloStatus === "verified"` and `catchAll !== true` → T1.
    - Verified and catch-all → T3 when `independentlyValid`, else T2.
    - Then T4, then T5, then T6.
  - `tierScore(t: EmailTier): number`: T1 and T3 score 2; T2, T4 and T5 score 1; T6 scores 0.
  - `isPostingStale(p: { live: boolean; firstPublishedAt: Date | null; sourceUpdatedAt: Date | null }, now: Date, staleDays: number): boolean`. A posting is stale when it is not live, or when it was first published more than `staleDays` ago with no update since.
  - `type FilterMpc = { workMode: "onsite" | "hybrid" | "remote" | "any"; employerType: "inhouse" | "firm" | "either"; yearsExperience: number | null; payFloor: number | null; payFloorStrict: boolean; regionExclusions: string[] }`.
  - `type FilterCandidate = Pick<DiscoveredCompany, "locationMatch" | "employerType" | "licenseRegion" | "salaryMax" | "yearsMax">` (Task 7 defines `DiscoveredCompany`; declare this type in `types.ts` with the same fields so Task 4 does not depend on Task 7).
  - `hardFilter(mpc: FilterMpc, c: FilterCandidate): { drop: DropCode | null; infos: InfoCode[] }`.
    - Location: `outside` drops. `remote` drops only when the MPC's `workMode` is `onsite`.
    - License region: drops when a `region_exclusion` value matches `licenseRegion`, case-insensitive, either containing the other.
    - Employer type: drops when the MPC is `inhouse` or `firm` and the company is the other type. `unknown` passes.
    - Overqualified: drops when the MPC's years exceed `yearsMax + OVERQUALIFIED_MARGIN_YEARS` (5).
    - Pay: when `salaryMax < payFloor`, a strict floor drops and a flag-only floor adds the info `pay_below_floor_flag_only`.
  - `payScore(mpc: { payFloor: number | null; payTarget: number | null }, salaryMax: number | null): number`: unknown is 1; at or above target (or floor when there is no target) is 2; between floor and target is 1; below floor is 0.
  - `decisionMakerScore(rule: DecisionMakerRule | "hr_fallback"): number`: `reports_to` and `local_team_leader` score 2, `function_head` and `most_senior` score 1, `hr_fallback` scores 0.
  - `classify(i: { drops: DropCode[]; needs: NeedsCode[]; flags: FlagCode[] }): Bucket`. Any drop → `drop`. Otherwise any need → `needs_research`. Otherwise any flag → `flagged`. Otherwise `clean`.
  - `repeatFlags(i: RepeatInput): { drop: DropCode | null; flags: FlagCode[]; infos: InfoCode[] }`. It implements the four spec repeat rules plus the large-firm exception. Its input:
    - `sameContactInWindow: boolean`
    - `otherContactsInWindow: number`
    - `companyOnLargeFirmList: boolean`
    - `declinedEver: boolean`
    - `priorPitchesSameMpc: number`
    - `newPostingOrNewDecisionMaker: boolean`
  - `orderProspects<T extends { kind: ProspectKind; scoreTotal: number }>(rows: T[]): T[]`. Advertised come first, then score descending. The sort is stable.
  - `OVERQUALIFIED_MARGIN_YEARS = 5`.

- [ ] **Step 1: Write the failing tests** as table-driven cases, one `test.each` per function, including:
  - `emailTier`:
    - verified, catchAll null → T1;
    - verified, catchAll true → T2;
    - verified, catchAll true, independently valid → T3;
    - "extrapolated" → T6 even when published-on-site is false;
    - off-domain verified → T6;
    - not verified but published on site → T4;
    - found in agency mail → T5.
  - `repeatFlags`:
    - same contact in window → `same_contact_recent`;
    - another contact at a non-large firm → `company_contact_recent`;
    - another contact at a large firm → no flag plus `large_firm_other_contact`;
    - declined ever → `company_declined`;
    - one prior pitch for this MPC with nothing new → drop `already_pitched_for_mpc`;
    - one prior pitch with something new → no drop and no third-pitch flag;
    - two prior pitches with something new → `third_pitch`.
  - `isPostingStale`, exactly at the boundary: 90 days ago is not stale, 91 days ago is stale, and an update 10 days ago is not stale.
  - `hardFilter`:
    - remote with onsite drops;
    - remote with hybrid passes;
    - region "arizona" matches license "Arizona (AZ)";
    - strict pay floor drops;
    - flag-only pay floor gives the info code;
    - 16 years against a 10-year max drops, 15 does not.
  - `classify` precedence.
  - `orderProspects` stability.
  - `CODE_TEXT has copy for every code and none contains an em dash`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/research-rules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `types.ts` and `rules.ts` as specified.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(research): pure rules for tiers, filters, repeats, buckets and scores`.

### Task 5: Capacity, allocation and overlap

**Files:**
- Create: `src/lib/research/allocate.ts`
- Test: `tests/unit/research-allocate.test.ts`

**Interfaces:**
- Produces:
  - `type AllocMpc = { mpcId: string; ownerUserId: string; overlapPriority: number; createdAt: Date }`.
  - `allocate(mpcs: AllocMpc[], capacityByOwner: Map<string, number>, perMpcTarget = 10): Map<string, number>` returns the target per MPC.
    - It works round-robin within each owner: one per MPC, then a second each, and so on, up to `perMpcTarget` each or the owner's capacity.
    - Order within a round is `overlapPriority` descending, then `createdAt` ascending.
  - `assignOverlaps(listings: { mpcId: string; domain: string }[], mpcs: AllocMpc[]): Map<string, string>` maps each domain to its winning MPC, using the same ordering.
  - `capacityByOwner(tx: Tx, settings: Settings): Promise<Map<string, number>>` gives each active member with connected inboxes `count × settings.newPitchCapPerInbox`.
  - `PER_MPC_TARGET = 10`.

- [ ] **Step 1: Write the failing tests**
  - `round-robin gives one each before any second`: capacity 3 with 5 MPCs gives the three highest-priority MPCs 1 each and the rest 0.
  - `capacity 40 with 3 MPCs gives 10, 10, 10`.
  - `capacity 25 with 3 MPCs gives 9, 8, 8 by priority`.
  - `one recruiter's capacity never fills another recruiter's MPCs`.
  - `zero capacity allocates nothing`.
  - `the higher overlapPriority MPC wins a shared company, ties go to the older MPC`.
  - `capacityByOwner counts only connected inboxes of active members`. It uses the database. The fixture has one disconnected inbox, one inbox in `needs_reconnect`, and one inbox belonging to a removed member; none of them count.
- [ ] **Step 2: Run** `npx vitest run tests/unit/research-allocate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `allocate.ts` as specified.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(research): per-recruiter capacity, round-robin allocation and overlap priority`.

### Task 6: ATS adapters and postings

**Files:**
- Create: `src/lib/research/ats/detect.ts`, `ats/greenhouse.ts`, `ats/lever.ts`, `ats/ashby.ts`, `ats/workday.ts`, `src/lib/research/postings.ts`, `tests/fixtures/research/ats-*.json`
- Test: `tests/unit/research-ats.test.ts`

**Interfaces:**
- Produces:
  - `type AtsRef = { ats: "greenhouse" | "lever" | "ashby" | "workday"; board: string; jobId: string | null; host?: string; site?: string }`.
  - `detectAts(url: string): AtsRef | null` recognizes these URL shapes:
    - `boards.greenhouse.io/{board}/jobs/{id}` and `job-boards.greenhouse.io/{board}/jobs/{id}`;
    - `jobs.lever.co/{board}/{id}`;
    - `jobs.ashbyhq.com/{board}/{id}`;
    - `{tenant}.wd{n}.myworkdayjobs.com/{site}/job/.../{slug}_{id}`.
  - `type AtsJob = { id: string; title: string; url: string; firstPublishedAt: Date | null; updatedAt: Date | null; salaryMin: number | null; salaryMax: number | null }`.
  - Board fetchers `fetchBoard(ref: AtsRef, fetchImpl = fetch): Promise<AtsJob[]>`, one per ATS, on these endpoints:
    - Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{board}/jobs`.
    - Lever: `https://api.lever.co/v0/postings/{board}?mode=json`.
    - Ashby: `https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true`.
    - Workday: `POST https://{host}/wday/cxs/{tenant}/{site}/jobs` with `{limit: 20, offset: 0, searchText: <title>}`.
  - `type PostingSource = "greenhouse" | "lever" | "ashby" | "workday" | "company_site" | "aggregator"`; `type CheckedPosting = { url: string; title: string | null; source: PostingSource; live: boolean; job: AtsJob | null; confirmed: boolean }`.
  - `checkPosting(input: { url: string; title: string | null; companyDomain: string }, deps: { fetchImpl?: typeof fetch; now: Date }): Promise<CheckedPosting>`.
    - An ATS URL that resolves to a job on its board is live and confirmed. An ATS URL whose job is missing from the board is not live.
    - A URL on the company's own domain is `company_site`, treated as confirmed and live when it returns HTTP 200.
    - Anything else is `aggregator` and is never confirmed.
  - `upsertPosting(tx: Tx, agencyId: string, companyId: string, p: CheckedPosting): Promise<{ postingId: string; isNew: boolean }>`. It sets `first_published_at` only once and updates `last_seen_live_at` when the posting is live.

- [ ] **Step 1: Write the failing tests**
  - `detectAts recognizes each board URL and rejects look-alikes`, for example `greenhouse.io.example.com`.
  - `greenhouse job present on the board is live with dates`.
  - `lever job missing from the board is not live`.
  - `ashby compensation becomes salary min and max`.
  - `aggregator urls are never confirmed`.
  - `a board fetch failure returns live false, confirmed false, and does not throw`.
  - `upsertPosting keeps the first published date on re-check`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/research-ats.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the adapters with a 15 s timeout each.
  - Confirm the date and compensation field names against each board's public docs before writing the mappers, and keep them in the adapter files.
  - Log nothing here; the pipeline logs.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(research): ATS board checks and posting records`.

### Task 7: Discovery (AI with web search) and the firm universe

**Files:**
- Create: `src/lib/research/segments.ts`, `src/lib/research/discover.ts`
- Test: `tests/unit/research-discover.test.ts`, `tests/unit/research-segments.test.ts`

**Interfaces:**
- Produces in `segments.ts`:
  - `segmentsFor(mpc: { specialtyTags: string[]; location: string; targetCities: string[] }): string[]`.
    - Each segment is `${slug(tag)}|${slug(region)}`, with `general` when there are no tags. Slugs are lower case, punctuation becomes spaces, and spaces collapse.
    - Results are de-duplicated, at most 20.
  - `loadKnownFirms(tx: Tx, mpcId: string, segments: string[]): Promise<KnownFirms>`, where `KnownFirms = { avoid: { name: string; domain: string; reason: string }[]; revisit: { name: string; domain: string; profile: CompanyProfile | null }[] }`.
    - `avoid` holds companies rejected in these segments plus companies already prospected for this MPC.
    - `revisit` holds up to 20 companies considered in these segments and not yet prospected for this MPC.
- Produces in `discover.ts`:
  - `type DiscoveryMpc`: headline role, location, target cities, years, seniority, specialty tags, credentials (kind and region), work mode, employer type, pay target, usable and confirmed fact texts (max 15), plus `avoidCompanies: string[]`. The avoid list holds MPC `excluded_company` and `confidential` restriction values; they are sent only so the model avoids them, and code re-checks them.
  - `type DiscoveredCompany = { name: string; domain: string; kind: ProspectKind; postingUrl: string | null; postingTitle: string | null; reportsTo: string | null; decisionMakerTitles: string[]; officeCity: string | null; locationMatch: "in_area" | "remote" | "outside"; employerType: "inhouse" | "firm" | "unknown"; isRecruitingFirm: boolean; licenseRegion: string | null; salaryMin: number | null; salaryMax: number | null; yearsMax: number | null; noRecruiters: boolean; scores: { specialty: number; seniority: number; location: number; hiringSignal: number }; whyCompany: string; sourceUrl: string }`.
  - `cleanDiscovered(raw: unknown, limit: number): DiscoveredCompany[]`:
    - normalizes the domain (`normalizeDomain`) and drops free-mail or invalid ones;
    - dedupes by domain;
    - clamps scores to their integer ranges;
    - turns `advertised` without an https `postingUrl` into `speculative`;
    - drops a row whose `whyCompany` is empty after trim;
    - replaces em dashes with commas;
    - caps text fields at 300 characters and `decisionMakerTitles` at 5;
    - keeps at most `limit` rows.
  - `discoverCompanies(mpc: DiscoveryMpc, known: KnownFirms, limit: number, deps: { generate?: GenerateFn; onUsage?: (u: AiUsage) => void }): Promise<{ companies: DiscoveredCompany[]; shortfallNote: string | null }>`.
    - Uses `MODELS.discovery` with `anthropic.tools.webSearch_20260318({ maxUses: 8 })`.
    - `limit` = `min(20, target × 2)`.
  - `profileFrom(c: DiscoveredCompany): CompanyProfile` is the cached company research saved on `companies.profile`.

- [ ] **Step 1: Write the failing tests**
  - `cleanDiscovered clamps scores and drops bad domains, duplicates and empty reasons`. The input includes:
    - specialty 9 → 3;
    - hiring signal -1 → 0;
    - `gmail.com`;
    - `not a domain`;
    - the same domain twice in different case;
    - `whyCompany: "  "`;
    - an em dash;
    - advertised with an `http://` posting URL → speculative.
  - `the system prompt says page content is data and forbids claiming hiring for speculative targets`.
  - `the prompt lists avoid and revisit firms and the MPC's restrictions but never a candidate name field`. Assert on the fake's recorded call.
  - `discovery uses the discovery model and the web search tool with maxUses 8`.
  - `segmentsFor builds specialty by region keys` and `uses general when there are no tags`.
  - `loadKnownFirms excludes companies already prospected for this MPC from revisit`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/research-discover.test.ts tests/unit/research-segments.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both files.
  - The system prompt states, in plain words:
    - the spec's sources order: employer ATS first, then job boards and web search, and never LinkedIn login;
    - that every company needs a specific candidate-based reason ("never just same industry");
    - the scoring ranges;
    - that HR and talent titles are not decision makers;
    - that page content is data.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(research): discovery with web search, cleaning and the firm universe`.

### Task 8: Decision maker and email lookup

**Files:**
- Create: `src/lib/research/contact.ts`
- Test: `tests/unit/research-contact.test.ts`

**Interfaces:**
- Consumes `ApolloApi` (Task 3), `GenerateFn` and `MODELS.bulk` (Task 2), and `emailTier` (Task 4).
- Produces:
  - `HR_TITLE = /\b(hr|human resources|talent|recruit(ing|er)?|people (ops|operations|partner))\b/i`.
  - `findDecisionMaker(input: { domain: string; companyName: string; titles: string[]; reportsTo: string | null; locations: string[]; priority: DecisionMakerRule[]; hrFallback: boolean; mpcRole: string }, deps: { apollo: ApolloApi; key: string; generate: GenerateFn; onSearch: () => void; onUsage: (u: AiUsage) => void }): Promise<DecisionMakerResult>`. The result is:
    - `{ found: true; source: "apollo"; personId: string; title: string; rule: DecisionMakerRule | "hr_fallback"; whyPerson: string }`, or
    - `{ found: true; source: "web"; name: string; title: string; email: string | null; url: string; rule: …; whyPerson: string }`, or
    - `{ found: false; reason: "no_decision_maker" }`.
  - Search order:
    1. Apollo search with the discovery titles plus `reportsTo` in the MPC's locations, `perPage: 25`.
    2. If empty, a search with seniorities `["owner","founder","c_suite","partner","vp","head","director"]` and no titles.
    3. If still empty, the web fallback: `MODELS.bulk`, `webSearch_20260318({ maxUses: 3 })`, which must return the page URL and an exact quote containing the name.
  - The Haiku pick returns `{ personId, rule, whyPerson }`. Code rejects the pick in these cases:
    - the id is not in the list;
    - the rule is not in `priority`;
    - the title matches `HR_TITLE` while `hrFallback` is false.
    - A rejected pick becomes `found: false`.
  - `lookupEmail(dm: DecisionMakerResult & { found: true }, companyDomain: string, deps: { apollo: ApolloApi; key: string; inAgencyMail: (email: string) => Promise<boolean>; onMatch: (credits: number) => void }): Promise<{ email: string | null; tier: EmailTier; name: string | null; apolloPersonId: string | null; rawStatus: string | null }>`.
    - Apollo results are matched by id. Web results with an email skip the paid match and come out as T4 when on the domain.
    - Web results without an email are matched by `{ name, domain }`.
    - `onMatch(1)` fires only when Apollo returned an email.

- [ ] **Step 1: Write the failing tests**
  - `falls back to senior titles when the title search is empty`.
  - `never picks an HR title unless hrFallback is on`.
  - `a pick outside the returned list is rejected`.
  - `web fallback runs only when Apollo returned nobody`.
  - `a web email on the company domain is T4 without a paid match`.
  - `a personal or off-domain email from Apollo is T6`.
  - `an email already in the agency's sent mail with no Apollo verification is T5`.
  - `onMatch counts a credit only when an email came back`.
  - `ApolloError propagates unchanged` (the pipeline handles it).
- [ ] **Step 2: Run** `npx vitest run tests/unit/research-contact.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `contact.ts` as specified.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(research): decision maker search and work email lookup`.

### Task 9: Candidate pipeline

**Files:**
- Create: `src/lib/research/log.ts`, `src/lib/research/pipeline.ts`
- Modify: `src/lib/ledger/record.ts` (export the existing `companyForDomain` as `ensureCompany(tx, agencyId, domain, name)`; behavior unchanged)
- Test: `tests/unit/research-pipeline.test.ts`

**Interfaces:**
- Produces in `log.ts`: `logStep(tx: Tx, row: { agencyId; runId; mpcId?; candidateId?; step: string; input: unknown; output?: unknown; error?: string }): Promise<void>`.
  - It truncates each JSON value to 16,000 characters.
  - It replaces any string equal to the Apollo key, or any `x-api-key` field, with `"[redacted]"`.
  - Steps are `discovery`, `company_checks`, `hard_filters`, `posting`, `apollo_search`, `ai_pick`, `web_contact`, `apollo_match`, `contact_checks`, `result`.
- Produces in `pipeline.ts`:
  - `type PipelineDeps = { apollo: ApolloApi; generate: GenerateFn; fetchImpl: typeof fetch; now: () => Date }`.
  - `processCandidate(agencyId: string, candidateId: string, deps: PipelineDeps): Promise<"done" | "parked">` runs these steps in order. Each step reads its checkpoint from `state` and skips work already saved.
    1. **Company:** `ensureCompany`, and save `companies.profile` from the discovery row.
    2. **Company checks** (drop):
       - `doNotContactMatch` by domain and name;
       - recruiting firm, when `settings.excludeRecruitingIndustry`;
       - MPC `excluded_company` or `confidential` restriction matching by `normalizeCompanyName` equality or by domain;
       - existing client;
       - universe rejected in any of the MPC's segments while the candidate is speculative (`rejected_before`);
       - prior pitches for this MPC with no new posting (decided again after step 6: the decision maker is new when the chosen Apollo person id, or the web contact's email, is not among the contacts already sent this MPC at this company).
    3. **Hard filters:** `hardFilter`.
    4. **Posting** (advertised only): `checkPosting`, then `upsertPosting`. Not confirmed → `posting_unconfirmed`. Stale → `posting_stale`.
    5. **Target check:** if the run MPC's `found` has reached its `target`, park the candidate (status `parked`, no paid step).
    6. **Decision maker:** `findDecisionMaker`. It is skipped with need `provider_failing` when there is no key or the key is failing, and with `budget_reached` when `recruiterMonthCostUsd ≥ 100`. A preview run still searches.
    7. **Email:**
       - A preview run → `preview_no_lookup`.
       - Otherwise `lookupEmail`, recording `provider_usage`.
       - Upsert the contact, with `apollo_person_id`.
    8. **Contact checks:**
       - `suppressionFor` → drop `suppressed`;
       - `lastContactAt` within the window → `same_contact_recent`;
       - `companyActivity(domain, since)` for other contacts and declines → `repeatFlags`;
       - no consent → `no_consent`;
       - `noRecruiters` → `no_recruiters`;
       - missing years or pay target → `mpc_open_question`;
       - tier T2 (without T3), T4 or T5 → `weak_email_tier`;
       - T6 → `no_verified_email`;
       - a specialty score of 0 → `fit_unestablished`.
    9. **Result:**
       - Score and `classify`, then insert the prospect.
       - Increment `found` when the bucket is clean or flagged.
       - Upsert `firm_universe` in each segment: `rejected` for codes in `UNIVERSE_REJECT_CODES = ["do_not_contact","recruiting_firm","existing_client","location"]`, else `considered`.
       - Record a `proposed` ledger event for clean and flagged prospects with an email. Use `source "rge"` and `dedupeKey proposed:{prospectId}`.
  - Every external call and every check outcome writes a `logStep` row. AI usage goes to `recordSystemAiUsage` with `userId` = the MPC owner.
  - Errors:
    - An `ApolloError` of kind `unauthorized` calls `markApolloFailing` and finishes the candidate as Needs research `provider_failing`.
    - `rate_limited` and server errors rethrow, so the tick retries the candidate, up to 3 attempts.

- [ ] **Step 1: Write the failing tests** with a PGlite database, a fake Apollo (call counter), a fake `generate` and a fake fetch.
  - `drops a company matching a confidential restriction or excluded company by name or domain`. This covers "Example Legal LLP" against restriction "example legal", and a domain match. The fake Apollo records zero calls.
  - `any company-level or hard-filter drop makes zero Apollo calls`. This is a parameterized test over DNC, recruiting firm, client, location, license, employer type, overqualified and strict pay.
  - `a clean prospect needs T1, an in-area company and nothing in the ledger`. It asserts the bucket is `clean`, the score total equals the sum of its parts, `found` increments, the universe row is `considered`, and the `proposed` event exists.
  - `another contact at a large-firm-list company within the window is clean with an info note`.
  - `a suppressed email is dropped after lookup and never becomes a contact event`.
  - `the target check parks candidates before any paid step once found reaches target`.
  - `an unauthorized Apollo response marks the key failing and stops further Apollo calls in the run`. A second candidate in the same run makes zero Apollo calls and lands in Needs research `provider_failing`.
  - `a resumed candidate does not repeat a saved Apollo match`. The candidate fails after the match is saved; `processCandidate` runs again, and the fake records exactly one match.
  - `the Apollo key never appears in research_log`.
  - `preview runs never call matchPerson and land in needs research with preview_no_lookup`.
  - `a stale or unconfirmed posting goes to needs research`.
  - `month-to-date cost at the ceiling skips AI and Apollo steps with budget_reached`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/research-pipeline.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `log.ts` and `pipeline.ts`. Each step's database writes run in one `withAgency` transaction. External calls happen between transactions, and each result is checkpointed before the next step.
- [ ] **Step 4: Run** the test, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(research): checkpointed candidate pipeline with audit log`.

### Task 10: Runs, the cron tick and preview

**Files:**
- Create: `src/lib/research/run.ts`, `src/lib/research/tick.ts`, `src/lib/research/preview-action.ts`, `src/app/api/cron/research/route.ts`
- Modify: `vercel.json` (add `{ "path": "/api/cron/research", "schedule": "*/5 * * * *" }`), `src/lib/public-paths.ts` (already covers `/api/cron/`; assert it in the test), `src/lib/mpc/actions.ts` (`updateMpc` clears `exhausted_at` and `research_empty_streak` when location, target cities, specialty tags, work mode or employer type change)
- Test: `tests/unit/research-run.test.ts`, `tests/unit/research-cron-route.test.ts`

**Interfaces:**
- Produces in `run.ts`:
  - `RESEARCH_START = "05:00"`. `LEASE_MS = 300_000`. `MAX_ATTEMPTS = 3`. `EXHAUSTED_AFTER = 3`. `PREVIEW_LIMITS = { perMpcPerDay: 1, perAgencyPerDay: 10 }`.
  - `localDate(now: Date, timeZone: string): string` (YYYY-MM-DD) and `localTime(now, timeZone): string` (HH:MM). Both use `Intl.DateTimeFormat`.
  - `ensureDailyRun(agencyId: string, now: Date): Promise<string | null>` creates and plans the day's run. It does this only when today is in `settings.sendDays`, the local time is ≥ `RESEARCH_START` and < `sendWindow.end`, and no daily run exists for the local date. It returns the run id or null.
  - Planning steps:
    1. `capacityByOwner`.
    2. Eligible MPCs: status `active`, owner an active member, `exhausted_at` null.
    3. `allocate`.
    4. Insert `research_run_mpcs` for targets > 0.
    5. Re-check the postings of open advertised prospects from earlier daily runs: a posting no longer live moves that prospect to `needs_research` with `posting_gone`.
    - Zero total capacity → the run is created `done` with `stop_reason: "No connected inbox, nothing researched"`, and nothing else runs.
  - `runDiscovery(agencyId, runMpcId, deps): Promise<void>`:
    1. Load the MPC and its known firms.
    2. Call `discoverCompanies`.
    3. Apply `assignOverlaps` against the candidates other run MPCs have already inserted for the same domain; a lower-priority duplicate is dropped as `taken_by_higher_priority`.
    4. Insert `research_candidates`.
    5. Set the status to `qualifying`.
  - `finishRun(agencyId, runId): Promise<void>`:
    - Writes the shortfall reasons. Example: "Found 3 of 10: 6 outside the area, 4 without a verified email". Built from prospect codes plus the discovery note.
    - Updates `research_empty_streak`, and sets `exhausted_at` after `EXHAUSTED_AFTER` empty daily runs. Preview runs never touch the streak.
    - Writes `summary` (`{ target, found, clean, flagged, needsResearch, dropped, apolloMatches, aiCostUsd }`).
- Produces in `tick.ts`: `runResearchTick(deadline: number, deps?: Partial<PipelineDeps>): Promise<{ agencies: number; steps: number }>`.
  - For each enabled agency (listed with `withSystem`): `ensureDailyRun`.
  - Then it claims work in this order, 3 at a time, until the deadline:
    1. pending run MPCs, for discovery;
    2. queued candidates, chosen round-robin by the run MPC with the lowest `found` relative to `target`, then by `overlapPriority`.
  - Claiming is `UPDATE … SET leased_until = now() + 5 min, attempts = attempts + 1 WHERE id = (SELECT … WHERE leased_until IS NULL OR leased_until < now() … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING`.
  - A candidate at `MAX_ATTEMPTS` becomes `failed` with `last_error`. A sanitized message is kept, never a key or a stack.
  - Once the agency's send window has closed for the day, remaining queued work becomes `parked` and the run becomes `stopped` with "Ran out of time before the send window closed".
  - A run is finished when no run MPC is pending or discovering and no candidate is queued or leased.
- Produces in `preview-action.ts`: `startPreviewRun(mpcId: string): Promise<{ ok: true; runId: string } | { ok: false; error: string }>`.
  - It requires `research.preview` with `{ ownerUserId }`, checks `PREVIEW_LIMITS` and the existing `aiLimitError`, and creates a `preview` run with `paid_lookups: false` and target 10.
  - It starts processing with `after(() => runResearchTick(Date.now() + 270_000))` from `next/server`.
- The cron route copies the gmail-sync route's authorization (constant-time `CRON_SECRET`), with `maxDuration = 300` and a tick of 270 s. It returns counts only.

- [ ] **Step 1: Write the failing tests**
  - `starts one daily run per local send day at 05:00 local`:
    - Phoenix: 04:59 local makes none, 05:00 creates one, and a second call the same day creates nothing. Friday (not a send day) makes none.
    - `America/New_York` on the November daylight saving date: 05:00 local is correct.
  - `zero capacity creates a done run and calls nothing paid`.
  - `paused, draft, exhausted MPCs and MPCs of removed members are not researched`.
  - `two concurrent ticks never claim the same candidate`. Run two `runResearchTick` promises against one PGlite database with a slow fake pipeline; each candidate is processed once.
  - `a candidate failing three times becomes failed with a sanitized error`.
  - `after the send window closes, queued work is parked and the run is stopped`.
  - `three empty daily runs mark the MPC exhausted, and editing its target cities clears it`.
  - `a posting that went away moves an open prospect to needs research with posting_gone`.
  - `finishRun writes the shortfall reason from codes and the discovery note`.
  - `preview is limited to once per MPC per day and recruiters can preview only their own MPCs`.
  - `cron route returns 401 without the secret and counts with it`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/research-run.test.ts tests/unit/research-cron-route.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the files above and add the cron entry to `vercel.json`.
- [ ] **Step 4: Run** the tests, `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(research): daily runs, leased cron tick and preview research`.

### Task 11: Research screens

**Files:**
- Create:
  - `src/lib/research/queries.ts`
  - `src/app/(app)/campaign/research/page.tsx` and `src/app/(app)/campaign/research/log/page.tsx`
  - `src/components/research/run-summary.tsx`, `mpc-table.tsx`, `prospect-list.tsx`, `needs-research-list.tsx`, `audit-log.tsx`, `usage-card.tsx`, `mpc-research-card.tsx`
  - `src/app/dev/research/page.tsx`
  - `tests/e2e/research.spec.ts`
- Modify: `src/components/campaign/health-strip.tsx`, `src/components/campaign/campaign-sections.tsx`, `src/app/(app)/campaign/page.tsx`, `src/app/(app)/mpcs/[id]/page.tsx`, `src/app/dev/campaign/page.tsx`, `tests/e2e/campaign.spec.ts`, `tests/e2e/mpc-profile.spec.ts`

**Interfaces:**
- Produces in `queries.ts` (each takes `member`; managers see the whole team, recruiters see all MPCs read-only with a "Mine / Team" filter):
  - `latestDailyRun(member): Promise<RunView | null>`.
  - `listRuns(member, limit = 14)`.
  - `runDetail(member, runId): Promise<{ run: RunView; mpcs: RunMpcView[]; prospects: ProspectView[]; needsResearch: ProspectView[]; failures: FailureView[] }>`.
  - `auditLog(member, runId, page)`. It requires `research.audit` and pages 100 rows at a time.
  - `usageSummary(member, now)`. It requires `usage.view` and gives, per recruiter, this month's AI cost, web searches, Apollo matches today and this month, and cost per prospect.
  - `mpcResearch(member, mpcId)`: last daily result, shortfall, exhausted, latest preview prospects.
- Screens:
  - **Health strip:** prepends "Research ran 5:02 AM · 41 prospects". When the run was stopped it shows the stop reason, and it says nothing when there is no run.
  - **Campaign tab, "Research" section:** found vs target, shortfall count, exhausted MPCs, Apollo lookups today, and a "View research" link. The empty state reads "Research runs at 5:00 AM on send days once inboxes are connected."
  - **Campaign tab, "Errors" section:** lists failed candidates, each with its reason and "RGE will not retry this one".
  - **`/campaign/research`:**
    - A run picker.
    - A per-MPC table: MPC headline, target, found, clean, flagged, needs research, dropped, shortfall reason, and an "Exhausted" badge.
    - A Prospects list in `orderProspects` order. Each row shows the Advertised or Speculative chip, company, contact name and title, email tier, flags in amber with `CODE_TEXT`, score, and the why-company sentence. A "More" disclosure shows the score parts, posting link and checks passed.
    - The Needs research list.
    - The usage card, managers only.
  - **`/campaign/research/log`:** managers only; everyone else gets a 404. It lists rows by time with step, MPC, company and error, and each row expands to its JSON.
  - **MPC page "Research" card:**
    - Last result: "Found 7 of 10 today".
    - The shortfall reason.
    - When exhausted: "No new companies left for this search. Widen it with more target cities, adjacent specialties or remote." with a link to edit.
    - A "Preview research" button with the help text "Finds companies and decision makers without using Apollo credits. Results are not drafted."
    - The latest preview results.
  - **Settings:** an Owner banner when Apollo is failing.

- [ ] **Step 1: Write the failing tests**
  - Unit (`tests/unit/research-queries.test.ts`):
    - `auditLog is refused for recruiters`.
    - `usageSummary groups by recruiter and month`.
    - `runDetail orders prospects advertised first then by score`.
  - e2e on `/dev/research`, which uses fixture data and the existing dev pattern:
    - The research page, the log page and the MPC research card render at 390 px and 1440 px with no horizontal scroll (`fit.ts`).
    - Flagged rows show the amber reason.
    - No page text contains an em dash.
- [ ] **Step 2: Run** `npx vitest run tests/unit/research-queries.test.ts` and `npx playwright test tests/e2e/research.spec.ts tests/e2e/campaign.spec.ts tests/e2e/mpc-profile.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the queries and screens with the existing Campaign and MPC components' styles: amber `#E0A23A` for flags, gold only for counts waiting on the user, and cards with a 12 px radius.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(research): research results, audit log, usage and MPC research card`.

### Task 12: Docs, deploy and verify

**Files:**
- Modify: `README.md` (sections "Research engine" and "Apollo key"), `docs/superpowers/plans/2026-11-24-rge-plan-3-research-engine.md` (append "Deploy outcome")

- [ ] **Step 1: Update the README.**
  - **How a daily run works:** the order of checks, capacity per recruiter, the 5-minute cron, the preview, the budget ceiling, and where the audit log lives.
  - **Apollo:** the Owner pastes the key in Settings > Integrations; the key needs `mixed_people/api_search` and `people/match` in its scope.
  - **Env vars:** no new ones. `RGE_TOKEN_KEY` and `CRON_SECRET` are already set.
- [ ] **Step 2: Run** `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e`. Expected: all green.
- [ ] **Step 3: Migrate production** with `node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs migrate`. Then verify with a read-only query: the new tables exist, RLS is enabled and forced, and the grants match Task 1.
- [ ] **Step 4: Push** the production branch, wait for the deployment to be READY, and check it:
  - `/api/cron/research` returns 401 without the secret.
  - It returns 200 with the secret, with counts and zero agencies researched. There is no inbox, so the run records "No connected inbox, nothing researched" on a send day after 05:00, or nothing at all otherwise.
  - `get_runtime_errors` shows nothing new.
- [ ] **Step 5: Append "Deploy outcome (date)" to this plan.** It records what was verified and what was not, such as signed-in screens and a real Apollo key. Then commit `docs: record Plan 3 deploy`.

**Not done in this plan, on purpose:**
- Entering WR's Apollo key. The founder pastes it in Settings when ready; a preview run then uses free calls only.
- Any real daily run. That needs connected inboxes, which wait for cutover.
- Drafting from prospects (Plan 4).
- Warm-up and overflow in capacity (Plan 5).
