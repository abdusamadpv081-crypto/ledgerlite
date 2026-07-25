-- Keep mutable-record timestamps authoritative in PostgreSQL rather than
-- relying on each application caller to remember to update them.

CREATE OR REPLACE FUNCTION platform.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_touch_updated_at
  BEFORE UPDATE ON platform.company
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER branch_touch_updated_at
  BEFORE UPDATE ON platform.branch
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER pos_device_touch_updated_at
  BEFORE UPDATE ON platform.pos_device
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER app_user_touch_updated_at
  BEFORE UPDATE ON platform.app_user
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER company_user_touch_updated_at
  BEFORE UPDATE ON platform.company_user
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER product_touch_updated_at
  BEFORE UPDATE ON catalog.product
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TRIGGER product_branch_touch_updated_at
  BEFORE UPDATE ON catalog.product_branch
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
