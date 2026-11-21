# RGE Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, branded RGE web app where an agency's team signs in with roles, and recruiters add, build, edit, pause and record consent for MPCs, with agency settings holding the spec's defaults.

**Architecture:** One Next.js (App Router, TypeScript) app at the repo root, deployed on Vercel. Postgres (Neon) through Drizzle, with every agency-owned table protected by Postgres row-level security keyed on a per-transaction `app.agency_id`. Clerk handles sign-in and organizations (one Clerk organization per agency); a webhook mirrors organizations and memberships into our tables. AI steps (profile extraction, Find more) call Claude through the AI SDK behind small interfaces so tests use fakes.

**Tech Stack:** Next.js (current stable), React, TypeScript (strict), Tailwind CSS v4, Drizzle ORM + `drizzle-kit`, Neon Postgres (`@neondatabase/serverless`), PGlite for tests, Clerk (`@clerk/nextjs`), Vercel Blob, AI SDK (`ai`, `@ai-sdk/anthropic`), Zod, Vitest, Playwright, `unpdf` (PDF text), `mammoth` (Word text).

**Spec:** `docs/superpowers/specs/2026-11-20-rge-v1-design.md`

## Global Constraints

- No candidate names, client contacts, email addresses, resumes or credentials in the repo; real data only in the database and `private/` (CLAUDE.md).
- Secrets only in `.env.local` (git-ignored) and Vercel environment variables.
- No em dashes, emojis or hype in any UI copy. Plain, direct wording.
- Brand tokens (spec 20): bg `#0A0A0A`; surfaces `#141414`, `#1A1A1A`; hover `#222222`; border `#2A2A2A`; text `#F5F5F0`, `#CCCCCC`; muted `#888888`; gold `#C8A84E`, gold-light `#D4B96A`, gold-dark `#A68A3E`; flag amber `#E0A23A`; deny/error `#D46A5E`; sent/approved `#6FB58A`. Montserrat for UI; Playfair Display italic only as rare accent. Buttons 6px radius; cards 12px radius. Uppercase headings with letter-spacing for page titles.
- Desktop and phone are equal priorities: every page is checked at 390x844 and 1440x900 with no horizontal scroll.
- Roles: `owner`, `admin`, `recruiter` (spec 3). Admin cannot remove the Owner or change the Owner's role.
- MPCs are owned by one recruiter; teammates in the same agency can view, not edit. Owners and Admins can edit any MPC.
- Fact statuses: `usable`, `interview_only`, `confirmed`. Facts from notes or transcripts start `interview_only`; from resume or linked web pages start `usable`.
- Missing consent is a warning, never a block.
- AI model ids: `claude-sonnet-5-5` for extraction and Find more. Model id lives in one constant.
- Node 24, npm. Windows dev machine: scripts must run in PowerShell and Git Bash.

## Review Focus

1. A user who belongs to two agencies switches organization: every list and every action must show and touch only the active agency's data (Task 2 RLS test, Task 3 context test).
2. Uploading a scanned PDF with no text layer, an empty file, a file over 10 MB, or an unsupported type: a clear message, nothing saved, no crash (Task 6 tests).
3. AI extraction returns a fact with no source quote, or a quote that does not appear in the source text: that fact is dropped, never saved (Task 6 test).
4. A recruiter posts the edit action for a teammate's MPC directly (bypassing the UI): rejected with a permission error and no change (Task 5 test).
5. Any page at 390px wide with long content (long firm names, 40 facts): no horizontal scroll, buttons reachable (Task 1 and Task 9 Playwright checks).

---

## File structure

```
src/
  app/
    layout.tsx                      root layout, fonts, Clerk provider
    (app)/layout.tsx                signed-in shell: sidebar (desktop), bottom tabs (phone)
    (app)/approvals/page.tsx        placeholder "Coming in Plan 4"
    (app)/mpcs/page.tsx             MPC list
    (app)/mpcs/new/page.tsx         add MPC
    (app)/mpcs/[id]/page.tsx        MPC profile view and edit
    (app)/team/page.tsx             users and roles
    (app)/settings/page.tsx         agency settings
    api/webhooks/clerk/route.ts     Clerk org and membership sync
    manifest.ts                     installable web app manifest
  components/                       shell, nav, Button, Card, Badge, Field, FactList
  db/
    schema.ts                       all Plan 1 tables
    rls.sql                         RLS policies (applied by migration)
    client.ts                       Neon client (prod) / PGlite (tests)
    with-agency.ts                  withAgency(agencyId, fn) transaction helper
  lib/
    auth.ts                         requireMember(), types
    permissions.ts                  can(role, action, ctx)
    settings-defaults.ts            spec default values
    mpc/actions.ts                  server actions for MPCs
    mpc/schema.ts                   Zod schemas for MPC input
    docs/text.ts                    extractText(file) for PDF, Word, text
    ai/models.ts                    model id constants
    ai/extract-profile.ts           extractProfile()
    ai/find-more.ts                 findMore()
tests/
  unit/...                          Vitest
  e2e/...                           Playwright
public/brand/                       logo assets copied from the RGE logo package
```

---

### Task 0: Accounts and keys (founder, before Task 1)

These need the founder's own sign-ups; the implementer does not create accounts.

- [ ] **Step 1:** Founder creates a Clerk application (Google sign-in enabled, Organizations enabled, roles `org:owner`, `org:admin`, `org:recruiter`) and shares the publishable key, secret key and webhook signing secret into `.env.local`.
- [ ] **Step 2:** Founder adds a Neon Postgres database to a new Vercel project named `rge-app` (Vercel Marketplace), and a Vercel Blob store. `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` go into `.env.local` and Vercel env.
- [ ] **Step 3:** Founder adds an Anthropic API key as `ANTHROPIC_API_KEY`.
- [ ] **Step 4:** Verify: `.env.local` lists `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `ANTHROPIC_API_KEY`; `git check-ignore .env.local` prints `.env.local`.

The existing Vercel project `recruiter-growth-engine` is the marketing site. Do not deploy the app to it.

---

### Task 1: App scaffold, brand and shell

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/(app)/layout.tsx`, `src/app/(app)/approvals/page.tsx`, `src/components/shell/*`, `src/app/manifest.ts`, `public/brand/*`, `vitest.config.ts`, `playwright.config.ts`, `tests/e2e/shell.spec.ts`
- Modify: `.gitignore` (add `.next/`, `node_modules/`, `test-results/`, `playwright-report/`)

**Interfaces:**
- Produces: `AppShell` with nav items in this order: Approvals, MPCs, Pipeline, Sent, Opt-outs, Dashboard, Team, Settings. Phone (<768px) bottom tabs: Approvals, MPCs, Pipeline, Sent, plus a Menu sheet with the rest. Desktop: left sidebar 220px with the mark-only logo and nav. Pages not built yet render a "Coming soon" empty state.
- Produces: Tailwind theme tokens named `bg`, `surface`, `card`, `hover`, `line`, `text`, `text-soft`, `muted`, `gold`, `gold-light`, `gold-dark`, `flag`, `deny`, `ok` with the Global Constraints values.
- Produces: dark theme by default; a light theme under `[data-theme="light"]` (bg `#FFFFFF`, surface `#F7F7F4`, card `#FFFFFF`, line `#E5E5E0`, text `#1A1A1A`, muted `#666666`, gold unchanged) using the light-background header logo; a Theme toggle (Dark, Light) in the user menu, remembered in a cookie.

- [ ] **Step 1:** Scaffold Next.js with TypeScript strict, Tailwind v4, ESLint, `src/` dir, App Router, npm. Add Vitest and Playwright. Copy from `C:\Users\ryanw\OneDrive\Desktop\RGE\`: `transparent/RGE-mark-32.png`, `-64`, `-128`, `-256`, `-512`, `transparent/RGE-header-for-dark-backgrounds.png`, `transparent/RGE-header-for-light-backgrounds.png`, `small/RGE-favicon.ico` into `public/brand/`.
- [ ] **Step 2: Write the failing Playwright test**

```ts
// tests/e2e/shell.spec.ts (runs against a test route that renders AppShell without auth: /dev/shell, only when NODE_ENV !== 'production')
for (const vp of [{ w: 390, h: 844, name: 'phone' }, { w: 1440, h: 900, name: 'desktop' }]) {
  test(`shell renders on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto('/dev/shell');
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Approvals' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'MPCs' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}
test('body uses brand background', async ({ page }) => {
  await page.goto('/dev/shell');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(10, 10, 10)');
});
```

- [ ] **Step 3:** Run `npx playwright test tests/e2e/shell.spec.ts`. Expected: FAIL (route missing).
- [ ] **Step 4:** Implement `AppShell`, theme tokens in `globals.css` (`@theme`), Montserrat and Playfair Display via `next/font/google`, the `/dev/shell` route (returns 404 in production), and `manifest.ts` (name "Recruiter Growth Engine", short_name "RGE", theme and background `#0A0A0A`, display `standalone`, icons from `public/brand`).
- [ ] **Step 5:** Run `npx playwright test tests/e2e/shell.spec.ts`. Expected: 3 passed.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "feat: scaffold app with brand shell"`

---

### Task 2: Database schema and agency isolation

**Files:**
- Create: `src/db/schema.ts`, `src/db/rls.sql`, `src/db/client.ts`, `src/db/with-agency.ts`, `drizzle.config.ts`, `drizzle/*` (generated), `tests/unit/db/isolation.test.ts`, `tests/helpers/test-db.ts`

**Interfaces:**
- Produces tables (all ids `uuid` default random; timestamps `created_at`, `updated_at`):
  - `agencies(id, clerk_org_id unique, name, time_zone default 'America/Phoenix')`
  - `users(id, clerk_user_id unique, email, name)`
  - `memberships(id, agency_id, user_id, role enum owner|admin|recruiter, unique(agency_id,user_id))`
  - `mpcs(id, agency_id, owner_user_id, status enum active|paused|removed|placed, pause_reason, headline_role, location, years_experience int null, seniority, specialty_tags text[], work_mode enum onsite|hybrid|remote|any, employer_type enum inhouse|firm|either, target_cities text[], pay_floor int null, pay_floor_strict bool default false, pay_target int null, overlap_priority int default 0)`
  - `mpc_credentials(id, agency_id, mpc_id, kind, region, verified bool)`
  - `mpc_facts(id, agency_id, mpc_id, text, source_kind enum resume|notes|transcript|web|manual, source_ref, source_quote, status enum usable|interview_only|confirmed, confirmed_by, confirmed_at)`
  - `mpc_restrictions(id, agency_id, mpc_id, kind enum never_say|confidential|excluded_company|region_exclusion, value)`
  - `mpc_consents(id, agency_id, mpc_id, given_on date, method enum verbal|email|signed_form, proof_blob_url null, recorded_by)`
  - `mpc_documents(id, agency_id, mpc_id, kind enum resume|notes|transcript, blob_url null, filename, text, created_by)`
  - `agency_settings(agency_id pk, values jsonb)`
- Produces: `withAgency<T>(agencyId: string, fn: (tx: Tx) => Promise<T>): Promise<T>` which opens a transaction, runs `select set_config('app.agency_id', $1, true)`, and runs `fn`. All agency tables have RLS `using (agency_id = current_setting('app.agency_id')::uuid)` and `with check` the same; the app connects as a non-owner role `rge_app` so policies apply.
- Produces: `createTestDb(): Promise<{ db, close }>` (PGlite, migrations applied, `rge_app` role).

- [ ] **Step 1: Write the failing test**

```ts
test('agency A cannot read or write agency B rows', async () => {
  const { db } = await createTestDb();
  const [a, b] = await seedAgencies(db, 2); // helper inserts agencies + one recruiter each as superuser
  await withAgency(b.id, tx => tx.insert(mpcs).values({ agencyId: b.id, ownerUserId: b.recruiterId, headlineRole: 'Nurse', location: 'Austin, TX' }));
  const seenByA = await withAgency(a.id, tx => tx.select().from(mpcs));
  expect(seenByA).toHaveLength(0);
  await expect(withAgency(a.id, tx => tx.insert(mpcs).values({ agencyId: b.id, ownerUserId: b.recruiterId, headlineRole: 'X', location: 'Y' }))).rejects.toThrow();
});
test('query without agency context returns nothing', async () => { /* select from mpcs outside withAgency -> 0 rows */ });
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/db/isolation.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement schema, generate migration with `npx drizzle-kit generate`, append `rls.sql` (role `rge_app`, `enable row level security` and the policy on every agency table) as a custom migration, implement `client.ts` (Neon in app, PGlite when `NODE_ENV === 'test'`) and `withAgency`.
- [ ] **Step 4:** Run the test. Expected: 2 passed.
- [ ] **Step 5:** Apply to Neon: `npx drizzle-kit migrate`. Expected: migrations applied, no errors.
- [ ] **Step 6:** Commit: `git commit -am "feat: schema with agency row-level security"`

---

### Task 3: Sign-in, agency sync and permissions

**Files:**
- Create: `src/middleware.ts`, `src/lib/auth.ts`, `src/lib/permissions.ts`, `src/app/api/webhooks/clerk/route.ts`, `src/app/sign-in/[[...sign-in]]/page.tsx`, `tests/unit/permissions.test.ts`, `tests/unit/webhook.test.ts`, `tests/unit/auth.test.ts`

**Interfaces:**
- Consumes: Task 2 tables and `withAgency`.
- Produces: `type Role = 'owner' | 'admin' | 'recruiter'`; `type Member = { userId: string; agencyId: string; role: Role }`; `requireMember(): Promise<Member>` (reads Clerk `auth()` active org and user, maps to our ids, redirects to `/sign-in` if none, to `/no-agency` if no active org).
- Produces: `can(member: Member, action: Action, target?: { ownerUserId?: string; targetRole?: Role }): boolean` with `Action = 'mpc.view' | 'mpc.edit' | 'team.manage' | 'team.setRole' | 'team.remove' | 'settings.edit'`.
- Produces test helpers in `tests/helpers/as-member.ts`: `asMember<T>(member: Member, fn: () => Promise<T>): Promise<T>` (stubs `requireMember` to return `member` for the duration of `fn`), `seedAgencies(db, n)` returning `{ id, ownerId, adminId, recruiterId, recruiter2Id }[]`, and member fixtures `owner`, `admin`, `recA`, `recB` (two recruiters in one agency). Tests in later tasks write `xAs(member, ...args)` as shorthand for `asMember(member, () => x(...args))`.
- Produces: webhook handling `organization.created|updated|deleted`, `organizationMembership.created|updated|deleted`, `user.created|updated`; Clerk role `org:owner|org:admin|org:recruiter` maps to our role; verifies the signature with `CLERK_WEBHOOK_SIGNING_SECRET`.

- [ ] **Step 1: Write the failing tests**

```ts
const rec = { userId: 'u1', agencyId: 'a', role: 'recruiter' } as const;
const admin = { ...rec, userId: 'u2', role: 'admin' } as const;
const owner = { ...rec, userId: 'u3', role: 'owner' } as const;
test('recruiter edits only own MPC', () => {
  expect(can(rec, 'mpc.edit', { ownerUserId: 'u1' })).toBe(true);
  expect(can(rec, 'mpc.edit', { ownerUserId: 'u9' })).toBe(false);
  expect(can(rec, 'mpc.view', { ownerUserId: 'u9' })).toBe(true);
});
test('admin and owner edit any MPC', () => {
  expect(can(admin, 'mpc.edit', { ownerUserId: 'u9' })).toBe(true);
  expect(can(owner, 'mpc.edit', { ownerUserId: 'u9' })).toBe(true);
});
test('admin cannot remove or re-role the owner', () => {
  expect(can(admin, 'team.remove', { targetRole: 'owner' })).toBe(false);
  expect(can(admin, 'team.setRole', { targetRole: 'owner' })).toBe(false);
  expect(can(admin, 'team.remove', { targetRole: 'recruiter' })).toBe(true);
  expect(can(rec, 'team.manage')).toBe(false);
  expect(can(rec, 'settings.edit')).toBe(false);
});
// webhook.test.ts: a signed organizationMembership.created payload creates agency, user and membership with role 'admin' for 'org:admin'; an unsigned payload returns 401 and writes nothing.
// auth.test.ts: a user in agencies A and B with active org B gets Member.agencyId === B.
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/permissions.test.ts tests/unit/webhook.test.ts tests/unit/auth.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `can`, `requireMember`, the webhook route (svix verification via Clerk's `verifyWebhook`), middleware protecting everything except `/sign-in`, `/api/webhooks/*`, `/manifest.webmanifest`, `/brand/*`.
- [ ] **Step 4:** Run the tests. Expected: all pass.
- [ ] **Step 5:** Commit: `git commit -am "feat: sign-in, agency sync and permissions"`

---

### Task 4: Team page

**Files:**
- Create: `src/app/(app)/team/page.tsx`, `src/lib/team/actions.ts`, `tests/unit/team-actions.test.ts`

**Interfaces:**
- Consumes: `requireMember`, `can`.
- Produces server actions: `inviteMember(email: string, role: Role)`, `setMemberRole(membershipId: string, role: Role)`, `removeMember(membershipId: string)`. Each calls Clerk's organization API and returns `{ ok: true } | { ok: false; error: string }`. Inviting as `owner` is not allowed; there is exactly one Owner.

- [ ] **Step 1: Write the failing tests** (Clerk client faked)

```ts
test('admin cannot remove owner', async () => {
  const r = await removeMemberAs(admin, ownerMembershipId);
  expect(r).toEqual({ ok: false, error: 'Only the Owner can change the Owner.' });
});
test('recruiter cannot invite', async () => {
  expect(await inviteMemberAs(rec, 'new@example.test', 'recruiter')).toEqual({ ok: false, error: 'You do not have permission to manage the team.' });
});
test('owner role cannot be granted by invite', async () => {
  expect((await inviteMemberAs(owner, 'x@example.test', 'owner')).ok).toBe(false);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/team-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the actions (with an injectable Clerk client) and the page: list of members (name, email, role badge), Invite form, role select and Remove for those `can` allows. Phone: stacked cards; desktop: table.
- [ ] **Step 4:** Run tests. Expected: pass.
- [ ] **Step 5:** Commit: `git commit -am "feat: team management"`

---

### Task 5: MPC list, add, edit, pause

**Files:**
- Create: `src/lib/mpc/schema.ts`, `src/lib/mpc/actions.ts`, `src/lib/mpc/queries.ts`, `src/app/(app)/mpcs/page.tsx`, `src/app/(app)/mpcs/new/page.tsx`, `src/app/(app)/mpcs/[id]/page.tsx`, `src/components/mpc/*`, `tests/unit/mpc-actions.test.ts`

**Interfaces:**
- Consumes: `withAgency`, `requireMember`, `can`.
- Produces: `mpcInput` Zod schema for the profile fields in Task 2 (`headlineRole` and `location` required, 1 to 120 chars; numbers non-negative; pay values whole dollars).
- Produces actions: `createMpc(input): Promise<{ ok: true; id: string } | { ok: false; error: string }>`, `updateMpc(id, input)`, `setMpcStatus(id, status: 'active' | 'paused' | 'removed', reason?: string)`, `pauseAllMpcs(reason: string)` (pauses the caller's own active MPCs; Owner/Admin may pass `scope: 'agency'`).
- Produces queries: `listMpcs(member, filter: { owner: 'me' | 'all'; status?: Status })` returning rows with `consentOnFile: boolean`, `interviewOnlyCount: number`, `missing: ('years' | 'payTarget')[]`; `getMpc(member, id)`.

- [ ] **Step 1: Write the failing tests**

```ts
test('recruiter cannot update a teammate MPC via direct call', async () => {
  const id = await createAs(recA, base);
  const r = await updateMpcAs(recB, id, { ...base, headlineRole: 'Changed' });
  expect(r).toEqual({ ok: false, error: 'You can only edit your own MPCs.' });
  expect((await getMpcAs(recA, id)).headlineRole).toBe(base.headlineRole);
});
test('missing years and pay target are reported', async () => {
  const id = await createAs(recA, { headlineRole: 'Litigation Associate', location: 'Phoenix, AZ' });
  const [row] = await listMpcsAs(recA, { owner: 'me' });
  expect(row.missing).toEqual(['years', 'payTarget']);
  expect(row.consentOnFile).toBe(false);
});
test('pause all pauses only my active MPCs', async () => { /* recA has 2 active, recB 1 active; after pauseAll by recA: recA's 2 paused, recB's still active */ });
test('blank headline role is rejected', async () => {
  expect((await createAs(recA, { headlineRole: '', location: 'X' } as any, { raw: true })).ok).toBe(false);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/mpc-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement schema, actions, queries and pages. List shows count ("21 MPCs"), owner filter (Mine, Team), status filter, and per row: headline role, location, status badge, amber "No consent on file" badge when missing, amber "N facts to confirm" when interview-only facts exist. Phone: cards; desktop: table. Edit page: sections Profile, Facts, Restrictions, Credentials, Consent, Documents; teammates see it read-only.
- [ ] **Step 4:** Run tests. Expected: pass.
- [ ] **Step 5:** Commit: `git commit -am "feat: MPC list, create, edit and pause"`

---

### Task 6: Documents and AI profile extraction

**Files:**
- Create: `src/lib/docs/text.ts`, `src/lib/ai/models.ts`, `src/lib/ai/extract-profile.ts`, `src/lib/mpc/document-actions.ts`, `src/components/mpc/AddSources.tsx`, `src/components/mpc/ExtractionReview.tsx`, `tests/unit/text.test.ts`, `tests/unit/extract-profile.test.ts`, `tests/fixtures/` (synthetic resume PDF and DOCX with fake people only)

**Interfaces:**
- Produces: `extractText(file: { name: string; type: string; bytes: Uint8Array }): Promise<{ ok: true; text: string } | { ok: false; error: string }>`. Accepts `.pdf`, `.docx`, `.txt`, `.md`; max 10 MB; errors: `'File is larger than 10 MB.'`, `'This file type is not supported. Use PDF, Word or text.'`, `'No text found. If this is a scanned PDF, paste the text instead.'`, `'The file is empty.'`
- Produces: `extractProfile(sources: { kind: 'resume' | 'notes' | 'transcript'; text: string; ref: string }[], deps?: { generate: GenerateFn }): Promise<ProfileDraft>` where `ProfileDraft = { fields: Partial<MpcInput>; facts: { text: string; sourceKind; sourceRef; sourceQuote: string }[]; restrictionsSuggested: { kind; value }[] }`. Uses `generateObject` with a Zod schema and `MODELS.extract` (`'claude-sonnet-5-5'`). After the model returns, drop any fact whose `sourceQuote` is not a substring of its source text (whitespace-normalized). Facts from `notes` and `transcript` get status `interview_only`; `resume` gets `usable`.
- Produces actions: `addDocument(mpcId, file | pastedText, kind)` stores the original in Blob (pasted text stored as text only) and its text in `mpc_documents`; `runExtraction(mpcId)` returns a `ProfileDraft` for review; `applyExtraction(mpcId, accepted: { fields; factIndexes: number[]; restrictionIndexes: number[] })` writes only what the user accepted.
- `ExtractionReview` shows each proposed field and fact with its source and a checkbox, all checked by default except restrictions (unchecked); Save applies the checked ones.

- [ ] **Step 1: Write the failing tests**

```ts
test('rejects files over 10 MB', async () => {
  expect(await extractText({ name: 'a.pdf', type: 'application/pdf', bytes: new Uint8Array(10 * 1024 * 1024 + 1) }))
    .toEqual({ ok: false, error: 'File is larger than 10 MB.' });
});
test('scanned PDF with no text gives the paste message', async () => {
  expect(await extractText(fixture('scanned-no-text.pdf'))).toEqual({ ok: false, error: 'No text found. If this is a scanned PDF, paste the text instead.' });
});
test('reads text from docx fixture', async () => {
  const r = await extractText(fixture('resume-fake.docx'));
  expect(r.ok && r.text).toContain('Led discovery on a $120M breach of contract matter');
});
test('drops facts whose quote is not in the source', async () => {
  const draft = await extractProfile([{ kind: 'resume', text: 'First-chaired two jury trials to verdict.', ref: 'resume.pdf' }], {
    generate: fakeGenerate({ facts: [
      { text: 'First-chaired two jury trials', sourceKind: 'resume', sourceRef: 'resume.pdf', sourceQuote: 'First-chaired two jury trials to verdict.' },
      { text: 'Won $50M verdict', sourceKind: 'resume', sourceRef: 'resume.pdf', sourceQuote: 'Won a $50M verdict' },
    ] }),
  });
  expect(draft.facts.map(f => f.text)).toEqual(['First-chaired two jury trials']);
});
test('notes facts come back interview_only', async () => { /* source kind notes -> applyExtraction saves status 'interview_only' */ });
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/text.test.ts tests/unit/extract-profile.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `extractText` (`unpdf` for PDF, `mammoth` for DOCX), `extractProfile` (prompt instructs: only facts stated in the sources, each with an exact quote; real highlights over baseline facts; never invent; suggest restrictions only when the source states one), the actions and the two components. Add/Edit MPC page gets "Add from resume, notes or transcript" (upload or paste).
- [ ] **Step 4:** Run tests. Expected: pass.
- [ ] **Step 5:** Commit: `git commit -am "feat: documents and AI profile extraction"`

---

### Task 7: Find more (public web facts)

**Files:**
- Create: `src/lib/ai/find-more.ts`, `src/lib/mpc/find-more-action.ts`, `tests/unit/find-more.test.ts`

**Interfaces:**
- Consumes: `MODELS.extract`, the `ExtractionReview` component.
- Produces: `findMore(mpc: { headlineRole; location; specialtyTags; facts: string[] }, hints: string, deps?: { generate: GenerateFn }): Promise<{ facts: { text: string; url: string; quote: string }[] }>` using Claude with the Anthropic web search tool. A fact without a `url` that starts with `https://` is dropped. Facts saved from Find more get `source_kind 'web'`, `source_ref` = url, status `usable`.
- `hints` is a free-text box ("current firm, bar number, publications"), because the search needs identifying details the pitch must never use. The recruiter's hints are never stored as facts.

- [ ] **Step 1: Write the failing test**

```ts
test('drops facts without an https source', async () => {
  const r = await findMore(sampleMpc, 'hint', { generate: fakeGenerate({ facts: [
    { text: 'Published article on coverage disputes', url: 'https://example.test/a', quote: 'article' },
    { text: 'Award', url: '', quote: 'award' },
  ] }) });
  expect(r.facts).toHaveLength(1);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/find-more.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire a "Find more" button on the MPC page that opens a hints box, runs the search, and shows results in `ExtractionReview` with links.
- [ ] **Step 4:** Run test. Expected: pass.
- [ ] **Step 5:** Commit: `git commit -am "feat: find more public facts"`

---

### Task 8: Facts, restrictions, credentials and consent editing

**Files:**
- Create: `src/lib/mpc/fact-actions.ts`, `src/lib/mpc/consent-actions.ts`, `src/components/mpc/FactList.tsx`, `src/components/mpc/RestrictionsEditor.tsx`, `src/components/mpc/ConsentCard.tsx`, `tests/unit/fact-actions.test.ts`

**Interfaces:**
- Produces: `confirmFact(factId)` (sets `confirmed`, `confirmed_by`, `confirmed_at`), `updateFact(factId, text)` (an edited `usable` fact stays `usable` with `source_kind` unchanged; an edited `interview_only` fact stays `interview_only`), `deleteFact(factId)`, `addManualFact(mpcId, text)` (status `confirmed`, source `manual`), `setRestrictions(mpcId, items)`, `setCredentials(mpcId, items)`, `recordConsent(mpcId, { givenOn, method, proofFile? })`.
- `FactList` groups: Ready to use (usable, confirmed) and To confirm (interview_only, amber), each fact showing its source (file name or link).
- `ConsentCard`: if none, amber "No consent on file. Outreach can still run; record consent to protect the agency." with a Record button.

- [ ] **Step 1: Write the failing tests**

```ts
test('confirming an interview-only fact makes it confirmed by the caller', async () => {
  const f = await seedFact({ status: 'interview_only' });
  await confirmFactAs(recA, f.id);
  const after = await getFact(f.id);
  expect(after.status).toBe('confirmed');
  expect(after.confirmedBy).toBe(recA.userId);
});
test('teammate cannot confirm facts on my MPC', async () => {
  expect((await confirmFactAs(recB, (await seedFact({ status: 'interview_only' })).id)).ok).toBe(false);
});
test('consent recorded clears the warning', async () => {
  await recordConsentAs(recA, mpcId, { givenOn: '2026-11-20', method: 'verbal' });
  expect((await listMpcsAs(recA, { owner: 'me' }))[0].consentOnFile).toBe(true);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/fact-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement actions and components; place them on the MPC page sections from Task 5.
- [ ] **Step 4:** Run tests. Expected: pass.
- [ ] **Step 5:** Commit: `git commit -am "feat: facts, restrictions and consent"`

---

### Task 9: Agency settings with spec defaults

**Files:**
- Create: `src/lib/settings-defaults.ts`, `src/lib/settings/actions.ts`, `src/app/(app)/settings/page.tsx`, `tests/unit/settings.test.ts`, `tests/e2e/pages-fit.spec.ts`

**Interfaces:**
- Produces: `DEFAULT_SETTINGS` and `getSettings(agencyId): Promise<Settings>` (stored values merged over defaults), `updateSettings(patch)` (Owner and Admin only). Values (spec 8, 10, 11, 13, 16):

```ts
export const DEFAULT_SETTINGS = {
  timeZone: 'America/Phoenix',
  sendDays: ['mon', 'tue', 'wed', 'thu'],
  sendWindow: { start: '09:00', end: '17:00' },
  minSpacingMinutes: 4,
  newPitchCapPerInbox: 40,
  warmupStartPerDay: 10,
  repeatWindowDays: 60,          // options 14, 30, 60, 90, or custom
  stalePostingDays: 90,
  excludeRecruitingIndustry: true,
  largeFirmList: [] as string[],
  decisionMakerPriority: ['reports_to', 'local_team_leader', 'function_head', 'most_senior'],
  hrFallback: false,
  averageFee: null as number | null,
  stageChances: { replied_interested: 10, call_booked: 25, resume_sent: 40, agreement_sent: 65, agreement_signed: 100 },
  approvalMode: 'manual' as 'manual' | 'auto',
  postalAddress: null as string | null,
  templates: {
    pitch: "Hi [First Name],\n\nI'm working with a [location] [role type] whose [specific background] could be relevant to your team:\n\n- [bullet]\n- [bullet]\n- [bullet]\n\nWould you be open to a call to discuss?\n\nBest,",
    followUp1: 'Hey [First Name], thoughts on this candidate?',
    breakup: "Hi [First Name],\n\nLast email about this candidate. If I come across another candidate who could be a fit for your team, I'll reach out.\n\nBest,",
    optOut: "Prefer not to receive these candidate introductions? Reply 'stop' and I'll remove you.",
  },
};
```

- Settings page sections: Agency (time zone, send days and window, repeat window, stale age, postal address), Rules (large-firm list, recruiting-industry exclusion, decision-maker priority, HR fallback), CRM (average fee, stage chances), Templates (four text areas), Approvals (mode; choosing Auto shows the warning "Emails will send without your review. You are responsible for every message sent from your account." and requires a confirm). Each setting has a one-line help text. Recruiters see settings read-only. Template text is checked for em dashes on save (error: "Remove em dashes from the template.").

- [ ] **Step 1: Write the failing tests**

```ts
test('defaults apply when nothing is stored', async () => {
  const s = await getSettingsFor(newAgencyId);
  expect(s.repeatWindowDays).toBe(60);
  expect(s.stageChances.call_booked).toBe(25);
  expect(s.templates.optOut).toBe("Prefer not to receive these candidate introductions? Reply 'stop' and I'll remove you.");
});
test('recruiter cannot update settings', async () => {
  expect((await updateSettingsAs(rec, { repeatWindowDays: 30 })).ok).toBe(false);
});
test('em dash in a template is rejected', async () => {
  expect(await updateSettingsAs(owner, { templates: { ...DEFAULT_SETTINGS.templates, breakup: 'Hi \u2014 there' } }))
    .toEqual({ ok: false, error: 'Remove em dashes from the template.' });
});
test('repeat window must be 1 to 365 days', async () => {
  expect((await updateSettingsAs(owner, { repeatWindowDays: 0 })).ok).toBe(false);
});
```

```ts
// tests/e2e/pages-fit.spec.ts: signed-in as a seeded test owner (Clerk testing token), visit /mpcs, /mpcs/<seeded id with 40 facts and a 90-character firm name restriction>, /team, /settings at 390x844 and 1440x900; assert no horizontal overflow and that the primary action button on each page is visible after scrolling into view.
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement defaults, merge, actions and page.
- [ ] **Step 4:** Run `npx vitest run` (all unit tests) and `npx playwright test`. Expected: all pass.
- [ ] **Step 5:** Commit: `git commit -am "feat: agency settings with spec defaults"`

---

### Task 10: Deploy and smoke check

**Files:**
- Create: `vercel.json` only if needed; `README.md` section "Running locally".

- [ ] **Step 1:** Link the repo to the `rge-app` Vercel project (`vercel link`), confirm env vars exist in Production and Preview, set the Clerk webhook endpoint to `https://<prod-domain>/api/webhooks/clerk`.
- [ ] **Step 2:** Deploy a preview: `vercel deploy`. Expected: build succeeds; URL printed.
- [ ] **Step 3:** On the preview at phone and desktop sizes, the founder signs in with Google, creates the "Whitton Recruiting" organization (becomes Owner), adds a test MPC from a synthetic resume, confirms one interview-only fact, records consent, pauses it. Expected: each step reflected after reload; the agency row exists in Neon.
- [ ] **Step 4:** Deploy production: `vercel deploy --prod`. Expected: success.
- [ ] **Step 5:** Commit README changes: `git commit -am "docs: running locally and deploy"`
