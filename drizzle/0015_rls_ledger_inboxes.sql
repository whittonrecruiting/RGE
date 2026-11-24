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
