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
