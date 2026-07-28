-- The first authoritative cash-sale sync path. A sale event is accepted only
-- as part of a transaction that also records its stock movement, posted journal
-- reference, and audit evidence. Browser outbox state is never authoritative.

ALTER TABLE pos.offline_operational_grant
  ADD CONSTRAINT offline_operational_grant_company_id_id_key
  UNIQUE (company_id, id);

ALTER TABLE pos.cash_shift
  ADD CONSTRAINT cash_shift_company_id_id_key UNIQUE (company_id, id);

CREATE TABLE pos.sale_event (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  device_id uuid NOT NULL,
  cashier_user_id uuid NOT NULL,
  cash_shift_id uuid NOT NULL,
  offline_grant_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  event_type text NOT NULL CHECK (event_type = 'cash_sale'),
  local_receipt_id uuid NOT NULL,
  local_sequence bigint NOT NULL CHECK (local_sequence > 0),
  occurred_at timestamptz NOT NULL,
  currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  payment_method text NOT NULL CHECK (payment_method = 'cash'),
  net_amount numeric(20, 6) NOT NULL CHECK (net_amount >= 0),
  tax_amount numeric(20, 6) NOT NULL CHECK (tax_amount >= 0),
  total_amount numeric(20, 6) NOT NULL CHECK (total_amount > 0),
  payment_amount numeric(20, 6) NOT NULL CHECK (payment_amount > 0),
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
  device_signature bytea NOT NULL CHECK (octet_length(device_signature) = 64),
  stock_exception boolean NOT NULL DEFAULT false,
  journal_entry_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sale_event_amounts_balanced CHECK (
    net_amount + tax_amount = total_amount
    AND payment_amount = total_amount
  ),
  CONSTRAINT sale_event_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT sale_event_company_receipt_key UNIQUE (company_id, local_receipt_id),
  CONSTRAINT sale_event_company_device_cashier_sequence_key
    UNIQUE (company_id, device_id, cashier_user_id, local_sequence),
  CONSTRAINT sale_event_company_branch_device_fk
    FOREIGN KEY (company_id, device_id, branch_id)
    REFERENCES platform.pos_device(company_id, id, branch_id) ON DELETE RESTRICT,
  CONSTRAINT sale_event_company_cashier_fk
    FOREIGN KEY (company_id, cashier_user_id)
    REFERENCES platform.company_user(company_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT sale_event_company_shift_fk
    FOREIGN KEY (company_id, cash_shift_id)
    REFERENCES pos.cash_shift(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_event_company_grant_fk
    FOREIGN KEY (company_id, offline_grant_id)
    REFERENCES pos.offline_operational_grant(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_event_company_policy_fk
    FOREIGN KEY (company_id, policy_id, policy_version)
    REFERENCES platform.policy_version(company_id, id, version) ON DELETE RESTRICT,
  CONSTRAINT sale_event_company_journal_fk
    FOREIGN KEY (company_id, journal_entry_id)
    REFERENCES accounting.journal_entry(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE pos.sale_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  sale_event_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  product_id uuid NOT NULL,
  product_name text NOT NULL CHECK (length(btrim(product_name)) BETWEEN 1 AND 240),
  sku text,
  quantity numeric(20, 6) NOT NULL CHECK (
    quantity > 0 AND quantity = trunc(quantity)
  ),
  unit_price numeric(20, 6) NOT NULL CHECK (unit_price > 0),
  tax_treatment text NOT NULL CHECK (tax_treatment IN ('inclusive', 'exclusive')),
  tax_code_id uuid,
  tax_code text,
  tax_name text,
  tax_rate numeric(9, 6),
  net_amount numeric(20, 6) NOT NULL CHECK (net_amount >= 0),
  tax_amount numeric(20, 6) NOT NULL CHECK (tax_amount >= 0),
  total_amount numeric(20, 6) NOT NULL CHECK (total_amount > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sale_line_amounts_balanced CHECK (net_amount + tax_amount = total_amount),
  CONSTRAINT sale_line_tax_snapshot_check CHECK (
    (tax_code_id IS NULL AND tax_code IS NULL AND tax_name IS NULL AND tax_rate IS NULL)
    OR (
      tax_code_id IS NOT NULL
      AND length(btrim(tax_code)) BETWEEN 1 AND 32
      AND length(btrim(tax_name)) BETWEEN 1 AND 120
      AND tax_rate >= 0 AND tax_rate <= 1
    )
  ),
  CONSTRAINT sale_line_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT sale_line_sale_line_number_key UNIQUE (sale_event_id, line_number),
  CONSTRAINT sale_line_company_sale_fk
    FOREIGN KEY (company_id, sale_event_id)
    REFERENCES pos.sale_event(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_line_company_product_fk
    FOREIGN KEY (company_id, product_id)
    REFERENCES catalog.product(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_line_company_tax_fk
    FOREIGN KEY (company_id, tax_code_id)
    REFERENCES catalog.tax_code(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE inventory.stock_movement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  sale_line_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type = 'sale'),
  quantity_delta numeric(20, 6) NOT NULL CHECK (
    quantity_delta < 0 AND quantity_delta = trunc(quantity_delta)
  ),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT stock_movement_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT stock_movement_sale_line_key UNIQUE (sale_line_id),
  CONSTRAINT stock_movement_company_branch_fk
    FOREIGN KEY (company_id, branch_id)
    REFERENCES platform.branch(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_movement_company_product_fk
    FOREIGN KEY (company_id, product_id)
    REFERENCES catalog.product(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_movement_company_sale_line_fk
    FOREIGN KEY (company_id, sale_line_id)
    REFERENCES pos.sale_line(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX sale_event_company_branch_accepted_at_idx
  ON pos.sale_event (company_id, branch_id, accepted_at DESC);
CREATE INDEX sale_event_company_shift_occurred_at_idx
  ON pos.sale_event (company_id, cash_shift_id, occurred_at);
CREATE INDEX sale_line_company_product_idx
  ON pos.sale_line (company_id, product_id);
CREATE INDEX stock_movement_on_hand_idx
  ON inventory.stock_movement (company_id, branch_id, product_id, occurred_at, id);

CREATE OR REPLACE FUNCTION inventory.stock_on_hand(
  p_branch_id uuid,
  p_product_id uuid
)
RETURNS numeric(20, 6)
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, platform, inventory
AS $$
  SELECT COALESCE(sum(quantity_delta), 0)::numeric(20, 6)
    FROM inventory.stock_movement
   WHERE company_id = platform.current_company_id()
     AND branch_id = p_branch_id
     AND product_id = p_product_id;
$$;

CREATE OR REPLACE FUNCTION pos.assert_sale_event_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, platform, catalog, accounting, inventory, pos
AS $$
DECLARE
  v_sale pos.sale_event%ROWTYPE;
  v_line_count integer;
  v_net_amount numeric(20, 6);
  v_tax_amount numeric(20, 6);
  v_total_amount numeric(20, 6);
  v_expected_stock_movements integer;
  v_actual_stock_movements integer;
  v_has_stock_exception boolean;
  v_journal_status text;
  v_journal_type text;
  v_source_type text;
  v_source_id uuid;
BEGIN
  SELECT * INTO v_sale FROM pos.sale_event WHERE id = NEW.id;
  SELECT count(*), COALESCE(sum(net_amount), 0), COALESCE(sum(tax_amount), 0),
         COALESCE(sum(total_amount), 0)
    INTO v_line_count, v_net_amount, v_tax_amount, v_total_amount
    FROM pos.sale_line WHERE sale_event_id = v_sale.id;
  IF v_line_count < 1
     OR v_net_amount <> v_sale.net_amount
     OR v_tax_amount <> v_sale.tax_amount
     OR v_total_amount <> v_sale.total_amount THEN
    RAISE EXCEPTION 'sale event totals do not match immutable sale lines';
  END IF;

  SELECT count(*) INTO v_expected_stock_movements
    FROM pos.sale_line AS line
    JOIN catalog.product AS product ON product.id = line.product_id
   WHERE line.sale_event_id = v_sale.id
     AND product.product_kind = 'stock';
  SELECT count(*) INTO v_actual_stock_movements
    FROM inventory.stock_movement AS movement
    JOIN pos.sale_line AS line ON line.id = movement.sale_line_id
   WHERE line.sale_event_id = v_sale.id
     AND movement.movement_type = 'sale'
     AND movement.branch_id = v_sale.branch_id
     AND movement.occurred_at = v_sale.occurred_at
     AND movement.quantity_delta = -line.quantity;
  IF v_expected_stock_movements <> v_actual_stock_movements THEN
    RAISE EXCEPTION 'sale event stock movements do not match stock sale lines';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pos.sale_line AS line
      JOIN catalog.product AS product ON product.id = line.product_id
     WHERE line.sale_event_id = v_sale.id
       AND product.product_kind = 'stock'
       AND inventory.stock_on_hand(v_sale.branch_id, line.product_id) < 0
  ) INTO v_has_stock_exception;
  IF v_sale.stock_exception IS DISTINCT FROM v_has_stock_exception THEN
    RAISE EXCEPTION 'sale event stock exception does not match resulting on-hand quantity';
  END IF;

  SELECT status, entry_type, source_type, source_id
    INTO v_journal_status, v_journal_type, v_source_type, v_source_id
    FROM accounting.journal_entry WHERE id = v_sale.journal_entry_id;
  IF v_journal_status <> 'posted'
     OR v_journal_type <> 'system'
     OR v_source_type <> 'pos.sale'
     OR v_source_id <> v_sale.id THEN
    RAISE EXCEPTION 'sale event must reference its posted system journal';
  END IF;
  RETURN NULL;
END;
$$;

ALTER TABLE pos.sale_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos.sale_event FORCE ROW LEVEL SECURITY;
ALTER TABLE pos.sale_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos.sale_line FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory.stock_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.stock_movement FORCE ROW LEVEL SECURITY;

CREATE POLICY sale_event_tenant_isolation ON pos.sale_event
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY sale_line_tenant_isolation ON pos.sale_line
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY stock_movement_tenant_isolation ON inventory.stock_movement
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());

CREATE TRIGGER sale_event_immutable
  BEFORE UPDATE OR DELETE ON pos.sale_event
  FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_change();
CREATE TRIGGER sale_line_immutable
  BEFORE UPDATE OR DELETE ON pos.sale_line
  FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_change();
CREATE TRIGGER stock_movement_immutable
  BEFORE UPDATE OR DELETE ON inventory.stock_movement
  FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_change();
CREATE CONSTRAINT TRIGGER sale_event_integrity
  AFTER INSERT ON pos.sale_event
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION pos.assert_sale_event_integrity();

GRANT USAGE ON SCHEMA inventory TO ledgerlite_app;
GRANT SELECT, INSERT ON pos.sale_event, pos.sale_line, inventory.stock_movement
  TO ledgerlite_app;
REVOKE ALL ON FUNCTION inventory.stock_on_hand(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory.stock_on_hand(uuid, uuid) TO ledgerlite_app;

COMMENT ON TABLE pos.sale_event IS
  'Accepted, device-signed POS cash-sale events. Presence is cloud acceptance and rows are immutable.';
COMMENT ON TABLE pos.sale_line IS
  'Immutable historical cash-sale line, price, and tax snapshots.';
COMMENT ON TABLE inventory.stock_movement IS
  'Immutable stock quantity ledger. US-032 adds sale movements; receipts and valuation follow in US-021.';
COMMENT ON FUNCTION inventory.stock_on_hand(uuid, uuid) IS
  'Returns the tenant-scoped branch/product quantity derived from immutable stock movements.';
COMMENT ON FUNCTION pos.assert_sale_event_integrity() IS
  'Deferred transaction check requiring matching immutable sale lines, stock movements, stock exception, and posted source journal.';
