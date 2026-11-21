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
