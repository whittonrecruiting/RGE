-- withAgency and withSystem run SET LOCAL ROLE rge_app / rge_system, so the connecting role must
-- be a member of both with the SET option. Since PostgreSQL 16 the creator of a role gets only
-- ADMIN on it (not SET), so grant it explicitly to the role running migrations. Re-running is
-- harmless. Before PostgreSQL 16 there is no SET option and a plain grant already allows SET ROLE.
-- A separate runtime login role needs the same grant (README, "Database roles").
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    EXECUTE 'GRANT rge_app, rge_system TO CURRENT_USER WITH SET TRUE';
  ELSE
    EXECUTE 'GRANT rge_app, rge_system TO CURRENT_USER';
  END IF;
END
$$;
