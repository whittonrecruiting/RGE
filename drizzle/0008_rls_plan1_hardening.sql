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
