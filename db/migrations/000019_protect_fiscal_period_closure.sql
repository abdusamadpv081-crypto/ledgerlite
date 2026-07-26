-- Only the controlled close function may change a fiscal period's lifecycle.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerlite_period_closer') THEN
    CREATE ROLE ledgerlite_period_closer NOLOGIN NOBYPASSRLS;
  END IF;
END;
$$;

CREATE TRIGGER fiscal_period_touch_updated_at
  BEFORE UPDATE ON accounting.fiscal_period
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE OR REPLACE FUNCTION accounting.reject_fiscal_period_lifecycle_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'closed' THEN
    RAISE EXCEPTION 'closed fiscal periods are immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'closed' THEN
      RAISE EXCEPTION 'closed fiscal periods are immutable';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND current_user <> 'ledgerlite_period_closer' THEN
      RAISE EXCEPTION 'fiscal periods must be closed through accounting.close_fiscal_period';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER fiscal_period_lifecycle_protected
  BEFORE UPDATE OR DELETE ON accounting.fiscal_period
  FOR EACH ROW EXECUTE FUNCTION accounting.reject_fiscal_period_lifecycle_mutation();

GRANT USAGE ON SCHEMA accounting TO ledgerlite_period_closer;
GRANT SELECT ON accounting.fiscal_period, accounting.journal_entry
  TO ledgerlite_period_closer;
GRANT UPDATE (status, closed_at, closed_by_user_id) ON accounting.fiscal_period
  TO ledgerlite_period_closer;

CREATE OR REPLACE FUNCTION accounting.close_fiscal_period(
  p_fiscal_period_id uuid,
  p_expected_updated_at timestamptz,
  p_closed_by_user_id uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, accounting
AS $$
DECLARE
  v_period accounting.fiscal_period%ROWTYPE;
  v_closed_at timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_period
    FROM accounting.fiscal_period
   WHERE id = p_fiscal_period_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fiscal period was not found';
  END IF;
  IF v_period.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'fiscal period was changed by another user';
  END IF;
  IF v_period.status <> 'open' THEN
    RAISE EXCEPTION 'fiscal period is not open';
  END IF;
  IF EXISTS (
    SELECT 1 FROM accounting.journal_entry
     WHERE fiscal_period_id = p_fiscal_period_id AND status = 'draft'
  ) THEN
    RAISE EXCEPTION 'fiscal period contains draft journals';
  END IF;
  UPDATE accounting.fiscal_period
     SET status = 'closed', closed_at = v_closed_at,
         closed_by_user_id = p_closed_by_user_id
   WHERE id = p_fiscal_period_id;
  RETURN v_closed_at;
END;
$$;

ALTER FUNCTION accounting.close_fiscal_period(uuid, timestamptz, uuid)
  OWNER TO ledgerlite_period_closer;

REVOKE ALL ON FUNCTION accounting.close_fiscal_period(uuid, timestamptz, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounting.close_fiscal_period(uuid, timestamptz, uuid)
  TO ledgerlite_app;

COMMENT ON FUNCTION accounting.close_fiscal_period(uuid, timestamptz, uuid) IS
  'Closes an unchanged open period only when it contains no draft journals.';
