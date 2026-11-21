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
