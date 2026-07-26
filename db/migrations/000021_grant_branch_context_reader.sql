-- Keep the new branch-context function separate from the broader identity
-- definer. This role has no login and can read only the relations required to
-- calculate a caller's own assigned active branches.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'ledgerlite_branch_context_reader'
  ) THEN
    CREATE ROLE ledgerlite_branch_context_reader NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA platform TO ledgerlite_branch_context_reader;
GRANT SELECT ON
  platform.app_user,
  platform.branch,
  platform.company,
  platform.company_user,
  platform.role_assignment
TO ledgerlite_branch_context_reader;

ALTER FUNCTION platform.list_active_branch_contexts()
  OWNER TO ledgerlite_branch_context_reader;
