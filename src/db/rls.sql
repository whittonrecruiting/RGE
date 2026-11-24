-- Agency isolation (row-level security). Source of truth: src/db/rls.sql.
-- This file is also the custom drizzle migration drizzle/0001_rls.sql; keep them identical
-- (tests/unit/db/isolation.test.ts enforces this).
--
-- The app connects as the non-owner role rge_app. withAgency() sets app.agency_id
-- transaction-locally; with no context, app_agency_id() is NULL and every policy matches zero rows.
-- rge_app gets no default privileges, so a new table is unreachable by the app until it is
-- granted here alongside its policy (fail closed).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rge_app') THEN
    CREATE ROLE rge_app NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint
-- nullif: once a session has set app.agency_id, the value outside that transaction is '' not NULL.
CREATE OR REPLACE FUNCTION app_agency_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.agency_id', true), '')::uuid $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO rge_app;--> statement-breakpoint
-- users is global (identity only), no RLS.
GRANT SELECT, INSERT, UPDATE ON "users" TO rge_app;--> statement-breakpoint
-- An agency sees only its own agency row.
ALTER TABLE "agencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agencies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "agencies" USING (id = app_agency_id()) WITH CHECK (id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "agencies" TO rge_app;--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "memberships" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "memberships" TO rge_app;--> statement-breakpoint
ALTER TABLE "mpcs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mpcs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "mpcs" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mpcs" TO rge_app;--> statement-breakpoint
ALTER TABLE "mpc_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mpc_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "mpc_credentials" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mpc_credentials" TO rge_app;--> statement-breakpoint
ALTER TABLE "mpc_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mpc_facts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "mpc_facts" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mpc_facts" TO rge_app;--> statement-breakpoint
ALTER TABLE "mpc_restrictions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mpc_restrictions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "mpc_restrictions" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mpc_restrictions" TO rge_app;--> statement-breakpoint
ALTER TABLE "mpc_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mpc_consents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "mpc_consents" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mpc_consents" TO rge_app;--> statement-breakpoint
ALTER TABLE "mpc_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mpc_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "mpc_documents" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mpc_documents" TO rge_app;--> statement-breakpoint
ALTER TABLE "agency_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "agency_settings" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "agency_settings" TO rge_app;

-- Fix round 1: close cross-agency gaps on the global users table and on memberships.
-- users stays global (no agency_id) but rge_app sees and edits only users who are members of
-- the current agency: the memberships subquery is itself filtered by memberships' RLS policy.
-- Users and memberships are created by a system path (Clerk webhook), never by rge_app.
-- src/db/rls.sql is the concatenation of every *_rls*.sql migration, in order (test-enforced).
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY member_of_current_agency_select ON "users" FOR SELECT USING (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id));--> statement-breakpoint
CREATE POLICY member_of_current_agency_update ON "users" FOR UPDATE USING (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id)) WITH CHECK (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id));--> statement-breakpoint
-- Identity (id, clerk_user_id) is not editable by the app.
REVOKE INSERT, UPDATE ON "users" FROM rge_app;--> statement-breakpoint
GRANT UPDATE ("email", "name", "updated_at") ON "users" TO rge_app;--> statement-breakpoint
-- Memberships: no insert, and only the role can change (not which user or agency).
REVOKE INSERT, UPDATE ON "memberships" FROM rge_app;--> statement-breakpoint
GRANT UPDATE ("role", "updated_at") ON "memberships" TO rge_app;

-- System path for the Clerk webhook and the sign-in membership lookup (src/db/with-system.ts).
-- rge_system is a NOLOGIN role without BYPASSRLS: it reaches agencies, users and memberships only
-- through the explicit policies below, and has no privileges at all on mpcs, mpc_* or any other
-- agency data. The connecting role assumes it with SET LOCAL ROLE, exactly as it assumes rge_app
-- (the session role must be allowed to SET ROLE to both).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rge_system') THEN
    CREATE ROLE rge_system NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO rge_system;--> statement-breakpoint
-- No DELETE: agency-owned tables cascade from agencies (and memberships from users), and
-- referential actions run as the table owner, so DELETE here would reach mpcs and mpc_* rows.
GRANT SELECT, INSERT, UPDATE ON "agencies", "users", "memberships" TO rge_system;--> statement-breakpoint
CREATE POLICY system_sync ON "agencies" TO rge_system USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY system_sync ON "users" TO rge_system USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY system_sync ON "memberships" TO rge_system USING (true) WITH CHECK (true);

-- Team removal is soft (memberships.status = 'removed'). The app can no longer delete membership
-- rows, so a removed member's references from MPCs, consents and facts stay intact, and it can
-- update the status (alongside the role) of memberships in its own agency.
REVOKE DELETE ON "memberships" FROM rge_app;--> statement-breakpoint
GRANT UPDATE ("status") ON "memberships" TO rge_app;

-- Plan 1 final review: agencies grants, the tenant gate and AI usage metering.
-- Tenant gate: agencies.enabled is changed only by the database owner (the founder, by hand; see
-- README). rge_app reads its own agency row and may change only the time zone (settings sync);
-- it never creates or deletes agencies.
REVOKE INSERT, UPDATE, DELETE ON "agencies" FROM rge_app;--> statement-breakpoint
GRANT UPDATE ("time_zone", "updated_at") ON "agencies" TO rge_app;--> statement-breakpoint
-- rge_system (Clerk sync) may rename an agency and record the Clerk event time, nothing else.
REVOKE UPDATE ON "agencies" FROM rge_system;--> statement-breakpoint
GRANT UPDATE ("name", "updated_at", "clerk_updated_at") ON "agencies" TO rge_system;--> statement-breakpoint
-- An agency created from a Clerk event always starts disabled.
CREATE POLICY system_insert_disabled ON "agencies" AS RESTRICTIVE FOR INSERT TO rge_system WITH CHECK (enabled = false);--> statement-breakpoint
-- One row per paid AI call. The app records and counts its own agency's rows; it never edits them.
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "ai_usage" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT ON "ai_usage" TO rge_app;

-- Saved pitch bullets: agency isolation like every MPC child table. The app saves a full set (delete
-- then insert) and never edits one in place, so it gets no UPDATE.
ALTER TABLE "mpc_saved_bullets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mpc_saved_bullets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "mpc_saved_bullets" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "mpc_saved_bullets" TO rge_app;

-- Plan 2: agency isolation for the company, contact, ledger, suppression, do-not-contact and inbox tables.
-- The ledger and suppressions are append-only for rge_app (no UPDATE, no DELETE): opt-outs and bounces stay permanent.
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "companies" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "companies" TO rge_app;--> statement-breakpoint
ALTER TABLE "company_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_domains" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "company_domains" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "company_domains" TO rge_app;--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "contacts" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "contacts" TO rge_app;--> statement-breakpoint
ALTER TABLE "inboxes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inboxes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "inboxes" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "inboxes" TO rge_app;--> statement-breakpoint
ALTER TABLE "ledger_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "ledger_events" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT ON "ledger_events" TO rge_app;--> statement-breakpoint
ALTER TABLE "suppressions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppressions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "suppressions" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT ON "suppressions" TO rge_app;--> statement-breakpoint
ALTER TABLE "do_not_contact" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "do_not_contact" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "do_not_contact" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "do_not_contact" TO rge_app;--> statement-breakpoint
ALTER TABLE "inbox_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbox_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "inbox_credentials" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "inbox_credentials" TO rge_app;
