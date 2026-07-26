-- A session needs a safe tenant picker before a client may request a
-- company-scoped resource. The function is deliberately actor-bound and does
-- not accept a user ID from the caller.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerlite_identity') THEN
    CREATE ROLE ledgerlite_identity NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA platform TO ledgerlite_identity;
GRANT SELECT ON platform.company, platform.company_user, platform.role_assignment TO ledgerlite_identity;

CREATE OR REPLACE FUNCTION platform.list_active_company_contexts()
RETURNS TABLE (
  company_id uuid,
  legal_name text,
  trade_name text,
  company_status text,
  roles text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_actor_user_id uuid := platform.current_actor_id();
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'company context requires an authenticated actor';
  END IF;

  RETURN QUERY
  SELECT
    company.id,
    company.legal_name,
    company.trade_name,
    company.status,
    array_agg(DISTINCT assignment.role_template ORDER BY assignment.role_template)
  FROM platform.company_user AS membership
  JOIN platform.company AS company ON company.id = membership.company_id
  JOIN platform.role_assignment AS assignment
    ON assignment.company_id = membership.company_id
   AND assignment.company_user_id = membership.id
  WHERE membership.user_id = v_actor_user_id
    AND membership.status = 'active'
    AND membership.effective_from <= now()
    AND (membership.effective_until IS NULL OR membership.effective_until > now())
    AND assignment.effective_from <= now()
    AND (assignment.effective_until IS NULL OR assignment.effective_until > now())
    AND company.status = 'active'
  GROUP BY company.id, company.legal_name, company.trade_name, company.status
  ORDER BY COALESCE(company.trade_name, company.legal_name);
END;
$$;

ALTER FUNCTION platform.list_active_company_contexts() OWNER TO ledgerlite_identity;
REVOKE ALL ON FUNCTION platform.list_active_company_contexts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.list_active_company_contexts() TO ledgerlite_app;

COMMENT ON FUNCTION platform.list_active_company_contexts() IS
  'Returns active company contexts only for app.current_actor_id() via a reviewed BypassRLS definer.';
