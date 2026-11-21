# RGE: Recruiter Growth Engine

Proprietary software for running the candidate-led **MPC (Most Placeable Candidate)** sales process end to end: candidate roster, prospect research, pitch drafting, a daily approval list, Gmail sending, follow-ups, reply handling, fee agreements and reporting.

Whitton Recruiting is the first user and runs on it for free; RGE is the product that other recruiting agencies subscribe to.

## Status

Building. Plan 1 (Foundation) is in place: Clerk sign-in with one organization per agency, the app shell, team management, agency settings, and MPC profiles (documents, AI extraction with quote checks, Find more web facts, facts, restrictions, credentials and consent). Prospects, drafting, approvals, sending and reporting come in later plans. The design is in `docs/superpowers/specs/2026-11-20-rge-v1-design.md`.

Stack: Next.js 16 and TypeScript, Clerk organizations, Postgres (Neon) through Drizzle with row-level security, Vercel Blob, the Vercel AI SDK with Anthropic, Vitest (on PGlite) and Playwright.

## Local setup

1. Node 24 or newer. `npm install`.
2. `cp .env.example .env.local` and fill in every value (see the comments in that file).
3. Create the database roles and schema: `npm run db:migrate` (runs as the owner over `DATABASE_URL_UNPOOLED`).
4. In Clerk, point a webhook at `/api/webhooks/clerk` (organization, organizationMembership and user events) and turn off "Allow users to create organizations".
5. `npm run dev`, then enable your agency (below).

Checks: `npm test` (unit, PGlite, no external services), `npm run test:e2e` (Playwright against `/dev/*` pages), `npm run typecheck`, `npm run lint`, `npm run build`.

## Enabling an agency

There are no self-serve tenants yet. An agency created in Clerk syncs into RGE disabled, and its members see "Your agency is waiting for approval." Neither app role can change this. The founder enables an agency with one statement, run as the database owner (for example in the Neon SQL editor):

```sql
UPDATE agencies SET enabled = true, updated_at = now() WHERE clerk_org_id = 'org_...';
```

Set it back to `false` to suspend an agency.

## Database roles

- **Owner** (the Neon database owner): runs migrations only, over the direct connection `DATABASE_URL_UNPOOLED`. `drizzle.config.ts` refuses to run without it.
- **rge_app** and **rge_system**: NOLOGIN roles created by the migrations. `withAgency` runs every app query as `rge_app` with the agency set, so row-level security applies; `withSystem` runs Clerk sync and the sign-in lookup as `rge_system`, which reaches only agencies, users and memberships.
- **Runtime login role** (recommended for production): the role in the pooled `DATABASE_URL`. It owns nothing and has no table grants of its own, is `NOINHERIT`, and is a member of `rge_app` and `rge_system` with the SET option, so it can only work through `SET LOCAL ROLE`. As the owner:

```sql
CREATE ROLE rge_runtime LOGIN NOINHERIT PASSWORD '...';
GRANT rge_app, rge_system TO rge_runtime WITH INHERIT FALSE, SET TRUE;
```

Migration `0009_session_role_grants` grants the same membership to the role that runs migrations, so a development setup that uses the owner for both still works.

## Repository layout

```
docs/        Design docs, specs and plans (no candidate or client data)
drizzle/     SQL migrations (src/db/rls.sql mirrors the row-level security ones)
src/         The Next.js app
tests/       Unit (Vitest + PGlite) and end-to-end (Playwright) tests
private/     Local-only working files, ignored by git (handoffs, rosters, exports)
```

## Data rule

This repository must never contain candidate names, client contacts, email addresses, resumes, API keys or OAuth tokens. Real data lives in the application database and in `private/` (git-ignored). See `CLAUDE.md`.
