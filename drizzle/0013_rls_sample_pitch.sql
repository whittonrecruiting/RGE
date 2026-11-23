-- Saved pitch bullets: agency isolation like every MPC child table. The app saves a full set (delete
-- then insert) and never edits one in place, so it gets no UPDATE.
ALTER TABLE "mpc_saved_bullets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mpc_saved_bullets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agency_isolation ON "mpc_saved_bullets" USING (agency_id = app_agency_id()) WITH CHECK (agency_id = app_agency_id());--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "mpc_saved_bullets" TO rge_app;
