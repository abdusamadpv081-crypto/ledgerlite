-- Branch-scoped roles need a safe discovery path without granting a tenant-wide
-- branch list. This lets a manager select only branches explicitly assigned to
-- them when registering or operating a POS device.

GRANT SELECT ON platform.app_user TO ledgerlite_identity;

CREATE OR REPLACE FUNCTION platform.list_active_branch_contexts()
RETURNS TABLE (
  company_id uuid,
  branch_id uuid,
  branch_code text,
  branch_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_actor_user_id uuid := platform.current_actor_id();
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'branch context requires an authenticated actor';
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    membership.company_id,
    branch.id,
    branch.code,
    branch.name
  FROM platform.company_user AS membership
  JOIN platform.app_user AS app_user ON app_user.id = membership.user_id
  JOIN platform.role_assignment AS assignment
    ON assignment.company_id = membership.company_id
   AND assignment.company_user_id = membership.id
  JOIN platform.branch AS branch
    ON branch.company_id = membership.company_id
   AND branch.id = assignment.branch_id
  JOIN platform.company AS company ON company.id = membership.company_id
  WHERE membership.user_id = v_actor_user_id
    AND app_user.status = 'active'
    AND membership.status = 'active'
    AND membership.effective_from <= now()
    AND (membership.effective_until IS NULL OR membership.effective_until > now())
    AND assignment.effective_from <= now()
    AND (assignment.effective_until IS NULL OR assignment.effective_until > now())
    AND company.status = 'active'
    AND branch.status = 'active'
    AND assignment.branch_id IS NOT NULL
  ORDER BY membership.company_id, branch.code;
END;
$$;

ALTER FUNCTION platform.list_active_branch_contexts() OWNER TO ledgerlite_identity;
REVOKE ALL ON FUNCTION platform.list_active_branch_contexts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.list_active_branch_contexts() TO ledgerlite_app;

COMMENT ON FUNCTION platform.list_active_branch_contexts() IS
  'Returns only active explicitly assigned branches for app.current_actor_id() via a reviewed BypassRLS definer.';
