# RGE Plan 1.5: MPC Flow and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five-tab navigation with a Campaign tab and Team inside Settings, a sources-first Add MPC flow with Draft MPCs, and a Sample pitch card with saved bullets on every MPC.

**Architecture:** Changes to the live Plan 1 app (Next.js 16, Drizzle, Postgres RLS via `withAgency`, Clerk, AI SDK behind `GenerateFn`). New migrations append after 0009; `src/db/rls.sql` stays equal to the concatenation of custom RLS migrations (a test enforces it). Every server action calls `requireMember()` and checks `can()`; DB only through `withAgency`.

**Tech Stack:** as Plan 1.

**Spec:** `docs/superpowers/specs/2026-11-20-rge-v1-design.md` (sections 6 "Adding and editing", "Structured profile", "Sample pitch"; 8 draft guard; 14 Campaign tab; 16 Settings; 20 Navigation).

## Global Constraints

- All Plan 1 global constraints apply (brand tokens, no em dashes or emojis in UI copy, 390x844 and 1440x900 with no horizontal scroll, roles, fact statuses, no real personal data in the repo).
- Navigation order exactly: Approvals, MPCs, Pipeline, Campaign, Settings. Phone shows all five in the bottom bar; no Menu sheet.
- MPC status values: `draft`, `active`, `paused`, `removed`, `placed`. Headline role and location may be null only while `draft`; enforced by a database CHECK constraint.
- A Draft becomes Active automatically when both headline role and location are set. Drafts are excluded from anything that researches, drafts or pitches (no such code exists yet; `listMpcs` exposes `status` so later plans can filter).
- Sample pitch uses only `usable` and `confirmed` facts, the agency pitch template from settings, and never sends anything.
- Paid AI calls (sample pitch included) go through `meteredAiCall` and the existing rate limits.

## Review Focus

1. A Draft with no role or location reaches any query or UI that assumes those fields are strings (MPC list sorting, profile read-only view, page titles): it must render "Untitled draft" and never crash (Task 2 test).
2. Extraction fails or is rate limited right after "Build profile": the Draft and its documents are saved and the page says what happened with a retry (Task 3 test).
3. A saved bullet's fact is edited or deleted: the bullet disappears from saved bullets, never left pointing at changed or missing text (Task 4 test).
4. A sample bullet introduces a number or claim not in its fact (for example "$500M" when the fact says "$120M"): dropped by the guard (Task 4 test).
5. Old links to /team, /sent, /opt-outs and /dashboard: redirect to the new home instead of 404 (Task 1 test).

---

### Task 1: Five-tab navigation, Campaign tab, Team in Settings

**Files:**
- Modify: `src/components/shell/nav-items.ts`, `src/components/shell/phone-nav.tsx`, `src/components/shell/nav-items.test.ts`, `src/app/(app)/[section]/page.tsx`, `src/app/(app)/settings/page.tsx`, `tests/e2e/shell.spec.ts`, `tests/e2e/settings.spec.ts`, `src/app/dev/settings/page.tsx`
- Create: `src/app/(app)/campaign/page.tsx`, `src/components/campaign/*`, `src/components/settings/team-section.tsx` (moved from `src/app/(app)/team/page.tsx` and `team-controls.tsx`), redirects for `/team`, `/sent`, `/opt-outs`, `/dashboard`
- Delete: `src/app/(app)/team/page.tsx` (replaced by redirect)

**Interfaces:**
- Produces: `NAV_ITEMS` = Approvals `/approvals`, MPCs `/mpcs`, Pipeline `/pipeline`, Campaign `/campaign`, Settings `/settings`. `PHONE_TAB_ITEMS = NAV_ITEMS` (all five); `PHONE_MENU_ITEMS` removed along with the Menu sheet.
- Produces: Settings page order: Team (first, `id="team"`), Agency, Rules, CRM, Templates, Approvals. Team section reuses the Plan 1 team actions unchanged (`inviteMember`, `setMemberRole`, `removeMember`); `revalidatePath` targets become `/settings`.
- Produces: Campaign page sections in order: health strip, Performance, Activity, Opt-outs and bounces, Errors. Each shows an empty state with this copy:
  - Health strip: "Research and sending start once inboxes are connected."
  - Performance: "Pitch, follow-up and reply numbers appear here once outreach starts."
  - Activity: "Every pitch and follow-up RGE sends will be listed here with its status."
  - Opt-outs and bounces: "People who opt out or bounce are listed here and never emailed again."
  - Errors: "Anything that fails to send or research will show here with the reason."
- Redirects (permanent, 308): `/team` -> `/settings#team`, `/sent` -> `/campaign`, `/opt-outs` -> `/campaign#opt-outs`, `/dashboard` -> `/campaign`.

- [ ] **Step 1: Failing tests.** `nav-items.test.ts`: labels equal `["Approvals","MPCs","Pipeline","Campaign","Settings"]` and phone tabs equal all five. `shell.spec.ts` (390x844): exactly five tab links visible in the bottom bar, no "Menu" button, no overflow (existing `FITS` helper). New `tests/e2e/redirects.spec.ts`: each old path responds with a redirect to its target (request with `maxRedirects: 0`, assert status 308 and `location`).
- [ ] **Step 2:** Run `npx vitest run src/components/shell/nav-items.test.ts` and `npx playwright test tests/e2e/shell.spec.ts tests/e2e/redirects.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Redirects in `next.config.ts` `redirects()`. The dev settings fixture gains the Team section with fake members.
- [ ] **Step 4:** Run the full unit suite and full Playwright suite. Expected: all pass, pages-fit still skipped.
- [ ] **Step 5:** Commit `feat: five-tab navigation with Campaign and Team in Settings`.

---

### Task 2: Draft MPCs

**Files:**
- Create: migration `drizzle/0010_mpc_draft.sql` (+ snapshot)
- Modify: `src/db/schema.ts`, `src/lib/mpc/schema.ts`, `src/lib/mpc/actions.ts`, `src/lib/mpc/queries.ts`, `src/lib/mpc/document-actions.ts` (applyExtraction activation), `src/components/mpc/badges.tsx`, `src/components/mpc/mpc-list.tsx`, `src/components/mpc/profile-form.tsx`, `src/components/mpc/profile-readonly.tsx`, `src/components/mpc/status-controls.tsx`, `src/app/(app)/mpcs/[id]/page.tsx`, `tests/unit/mpc-actions.test.ts`, `tests/unit/document-actions.test.ts`

**Interfaces:**
- Schema: add `draft` to `mpc_status` (`ALTER TYPE ... ADD VALUE 'draft' BEFORE 'active'`, in its own migration statement); `mpcs.headline_role` and `mpcs.location` nullable; CHECK `mpcs_required_unless_draft` = `status = 'draft' OR (headline_role IS NOT NULL AND location IS NOT NULL)`. Default status stays `active` for `createMpc`.
- Produces: `createDraftMpc(): Promise<{ ok: true; id: string } | { ok: false; error: string }>` (owner = caller, status `draft`, all fields null/empty).
- Produces: `updateMpc(id, input)` accepts a Draft with role or location blank (validated by `mpcDraftInput`, same as `mpcInput` but those two optional); for non-drafts `mpcInput` still requires them. After any successful update or `applyExtraction`, a Draft with both fields set becomes `active` in the same transaction (`activated: true` added to the result).
- Produces: `setMpcStatus` refuses `active` for a Draft missing a required field: "Add the headline role and location before activating." `pauseAllMpcs` skips drafts.
- `MpcRow` gains `status` already present; `missing` gains `'headlineRole' | 'location'` (listed first). Display name for a Draft without role: "Untitled draft".
- UI: amber "Draft" badge in list and page header; amber outline on empty required fields with "Required to activate"; banner on Draft pages: "This MPC is a draft. Add the headline role and location to activate it."

- [ ] **Step 1: Failing tests.**

```ts
test('createDraftMpc saves a draft with no fields', async () => { const r = await createDraftMpcAs(recA); expect(r.ok).toBe(true); expect((await getMpcAs(recA, r.id)).status).toBe('draft'); });
test('database rejects an active MPC without a role', async () => { /* direct insert with status active, headline_role null -> throws */ });
test('a draft activates when role and location are both set', async () => {
  const { id } = await createDraftMpcAs(recA);
  expect((await updateMpcAs(recA, id, { location: 'Phoenix, AZ' })).ok).toBe(true);
  expect((await getMpcAs(recA, id)).status).toBe('draft');
  const r = await updateMpcAs(recA, id, { headlineRole: 'Litigation Associate', location: 'Phoenix, AZ' });
  expect(r).toMatchObject({ ok: true, activated: true });
  expect((await getMpcAs(recA, id)).status).toBe('active');
});
test('applyExtraction activates a draft when it fills role and location', async () => { /* signed draft with both fields -> status active */ });
test('cannot set a draft active without required fields', async () => { expect(await setMpcStatusAs(recA, draftId, 'active')).toEqual({ ok: false, error: 'Add the headline role and location before activating.' }); });
test('listMpcs shows drafts with missing role and location first', async () => { expect(row.missing.slice(0, 2)).toEqual(['headlineRole', 'location']); });
test('non-draft update still requires headline role', async () => { expect((await updateMpcAs(recA, activeId, { ...base, headlineRole: '' })).ok).toBe(false); });
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/mpc-actions.test.ts tests/unit/document-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement; generate migration with `npm run db:generate`, hand-check the enum value addition and CHECK constraint; keep RLS sync test green.
- [ ] **Step 4:** Full unit suite and Playwright (extend `/dev/mpcs` fixture with a Draft row with no role and a 90-character location). Expected: pass.
- [ ] **Step 5:** Commit `feat: draft MPCs that activate when role and location are set`.

---

### Task 3: Sources-first Add MPC

**Files:**
- Modify: `src/app/(app)/mpcs/new/page.tsx`, `src/components/mpc/AddSources.tsx`, `src/app/(app)/mpcs/[id]/page.tsx`, `src/lib/mpc/document-actions.ts`
- Create: `src/components/mpc/BuildProfile.tsx`, `src/lib/mpc/build-profile-action.ts`, `tests/unit/build-profile.test.ts`, `tests/e2e/add-mpc.spec.ts`, `src/app/dev/add-mpc/page.tsx`

**Interfaces:**
- Consumes: `createDraftMpc`, `addDocument(mpcId, formData)`, `runExtraction(mpcId)`, `ExtractionReview`.
- Produces: `buildProfile(formData: FormData): Promise<{ ok: true; mpcId: string; documentErrors: { name: string; error: string }[] } | { ok: false; error: string }>`. FormData holds any number of `file` entries and `paste` entries, each with a matching `kind` (`resume` | `notes` | `transcript`). Creates one Draft, adds every source (each validated by the existing `extractText` rules; invalid sources reported in `documentErrors`, valid ones kept), returns the id. Fails with "Add at least one resume, notes or transcript." if nothing valid was supplied (and creates no Draft).
- Add MPC page: one screen with a drop zone (multiple files), a "Paste text" button adding a paste box, a kind selector per item (default resume for PDF and Word, notes for pasted text), and a primary button "Build profile". On success it navigates to `/mpcs/<id>?review=1`.
- MPC page with `?review=1`: runs `runExtraction` once on load and opens `ExtractionReview` at the top. On extraction failure, shows "We saved this draft and its documents, but could not build the profile: <reason>." with a "Try again" button. Required-field highlighting from Task 2 shows after Save.
- Secondary link on the Add page: "Or fill in the profile by hand" creates an empty Draft and opens its page.

- [ ] **Step 1: Failing tests.** `build-profile.test.ts`: two files plus one paste create one Draft with three documents; an unsupported file is listed in `documentErrors` while the rest are saved; nothing valid returns the error and creates no MPC; a recruiter cannot build into another agency (RLS). `add-mpc.spec.ts` on `/dev/add-mpc`: page fits at both sizes, Build profile visible, adding a paste box works.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full unit and Playwright suites. Expected: pass.
- [ ] **Step 5:** Commit `feat: sources-first Add MPC that builds a draft profile`.

---

### Task 4: Sample pitch and saved bullets

**Files:**
- Create: migration `drizzle/0011_sample_pitch.sql` (+ snapshot), `src/lib/ai/sample-pitch.ts`, `src/lib/mpc/sample-pitch-action.ts`, `src/lib/mpc/pitch-guard.ts`, `src/components/mpc/SamplePitch.tsx`, `tests/unit/sample-pitch.test.ts`, `tests/unit/pitch-guard.test.ts`
- Modify: `src/db/schema.ts` (`ai_purpose` gains `sample_pitch`; new table `mpc_saved_bullets`), `src/lib/mpc/fact-actions.ts` (edit or delete clears saved bullets for that fact), `src/lib/mpc/queries.ts` (readiness), `src/components/mpc/badges.tsx`, `src/components/mpc/mpc-list.tsx`, `src/app/(app)/mpcs/[id]/page.tsx`, the custom RLS migration and `src/db/rls.sql`

**Interfaces:**
- Table `mpc_saved_bullets(id, agency_id, mpc_id, fact_id, position smallint 1..3, text, created_by, created_at)`: composite FKs `(agency_id, mpc_id) -> mpcs`, `(agency_id, fact_id) -> mpc_facts(agency_id, id) ON DELETE CASCADE`, `(agency_id, created_by) -> memberships`; unique `(mpc_id, position)`; agency RLS like other tables; `rge_app` SELECT, INSERT, DELETE.
- Readiness: `strongFactCount` = usable + confirmed facts; `pitchReady = strongFactCount >= 3 || savedBullets.length === 3`. `listMpcs` rows gain `pitchReady: boolean`; list badge "Pitch ready" (green) or "Needs facts" (amber); Drafts show neither.
- `checkBullet(text: string, factText: string): string | null` in `pitch-guard.ts`: returns an error string or null. Rules: 3 to 12 words; no em dash; every number or dollar figure in the bullet appears in the fact text (normalize `$120M`, `120 million`, `$120,000,000` style to digits for comparison); no candidate-name placeholder; no pay words (salary, compensation, $ followed by "K" next to "base"); no visa or work authorization terms.
- `generateSamplePitch(mpcId, opts?: { swapPosition?: 1|2|3 }): Promise<{ ok: true; pitch: SamplePitch } | { ok: false; error: string }>` where `SamplePitch = { subject; body; bullets: { factId; text }[]; warnings: string[] }`. Requires the MPC not to be a Draft ("Activate this MPC before previewing a pitch."). Picks from usable and confirmed facts only; AI (MODELS.extract, metered as `sample_pitch`) returns `{ background, bullets: [{ factId, text }] }`; bullets whose factId is not an eligible fact of this MPC or that fail `checkBullet` are dropped; if fewer than 3 survive, `warnings` explains ("Only 2 strong facts. Confirm a note or run Find more."). Rendered with `settings.templates.pitch`, `[location]` and `[role type]` from the MPC, subject `<headline role>?`, greeting `Hi [First Name],` left as is, followed by the opt-out line; the full rendered email passes the em dash check. If saved bullets exist, they are used and only `swapPosition` is regenerated.
- `saveBullets(mpcId, bullets: { factId; text }[])`: exactly 3, each re-checked with `checkBullet` against its stored fact, replaces existing saved bullets; owner or Owner/Admin only.
- `SamplePitch` card on the MPC page (after Facts): rendered preview in the white email style, warnings in amber, buttons Regenerate, Swap a bullet (per bullet), Use these bullets. Saved state shows "Saved bullets in use" with Clear.

- [ ] **Step 1: Failing tests.** `pitch-guard.test.ts`: "$500M" bullet against a "$120M" fact fails; "$120M" passes; em dash fails; 2 words fails; "seeking $250K base" fails. `sample-pitch.test.ts` (fake generate): bullets from interview_only facts are dropped; bullet with another MPC's factId dropped; three good bullets render with the template and opt-out line; Draft MPC refused; saved bullets used and only the swapped position changes; editing a saved fact removes its saved bullet; deleting it cascades; a call is recorded in `ai_usage` with purpose `sample_pitch` and the rate limit applies.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement; migration via `npm run db:generate` plus the custom RLS migration; keep the sync test green.
- [ ] **Step 4:** Full unit and Playwright suites (extend `/dev/mpc-profile` with the card in each state). Expected: pass.
- [ ] **Step 5:** Commit `feat: sample pitch preview with saved bullets on every MPC`.

---

### Task 5: Apply migrations and deploy (controller, after final review)

- [ ] Apply 0010 and 0011 to Neon with `node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs migrate`; verify enum, CHECK constraint, new table RLS forced.
- [ ] Merge to `claude/rge-repository-0nxb3b`, push (founder's go-ahead), confirm the Vercel production build is READY and `/mpcs/new` loads.

## Open follow-ups (after go-live, 2026-11-23)

Plan 1.5 shipped to production on 2026-11-23 (migrations 0010-0013 applied, commit b345982). Minor review items deferred during the build, none blocking:

- Fixed 2026-11-23: missing file-like paths (for example `/apple-touch-icon.png`) returned 500; the proxy matcher now skips only `_next/` and `brand/`.
- `isCheckViolation` should match the constraint name, not only SQLSTATE 23514.
- A failed Build profile transaction can leave orphan blobs; sources are processed one at a time; pasted text size is counted in characters, not bytes.
- The CHANGED (concurrent edit) path in Build profile is untested.
- Number guard: N-figure parsing accepts odd words (first-figure, double-figure); compound spelled numbers are split with a confusing message; fact magnitude wording must match exactly.
- Plan 4 must re-run the pitch guard on saved bullets at send time, not trust them.
- `TeamPerson` type is imported from UI into lib; the dev campaign fixture page duplicates the page body; no per-tab label clip check at 390px.
- `MpcDraftInput` full-replace semantics need a comment.
