-- A cash shift records custody of a registered till before POS sales. Opening
-- a shift is intentionally not an accounting posting; cash movements and
-- financial close are separate, immutable events.

ALTER TABLE platform.pos_device
  ADD CONSTRAINT pos_device_company_id_id_branch_id_key
  UNIQUE (company_id, id, branch_id);

CREATE TABLE pos.cash_shift (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  device_id uuid NOT NULL,
  cashier_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'close_requested', 'closed', 'voided')),
  opened_source text NOT NULL DEFAULT 'online'
    CHECK (opened_source IN ('online', 'offline')),
  opening_event_id uuid,
  currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  opening_float numeric(20, 6) NOT NULL
    CHECK (
      opening_float >= 0
      AND opening_float <= 999999999999.99
      AND opening_float = trunc(opening_float, 2)
    ),
  policy_id uuid NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cash_shift_opening_event_source_check CHECK (
    (opened_source = 'online' AND opening_event_id IS NULL)
    OR (opened_source = 'offline' AND opening_event_id IS NOT NULL)
  ),
  CONSTRAINT cash_shift_company_branch_device_fk
    FOREIGN KEY (company_id, device_id, branch_id)
    REFERENCES platform.pos_device(company_id, id, branch_id)
    ON DELETE RESTRICT,
  CONSTRAINT cash_shift_company_cashier_fk
    FOREIGN KEY (company_id, cashier_user_id)
    REFERENCES platform.company_user(company_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT cash_shift_company_policy_fk
    FOREIGN KEY (company_id, policy_id, policy_version)
    REFERENCES platform.policy_version(company_id, id, version)
    ON DELETE RESTRICT,
  CONSTRAINT cash_shift_company_opening_event_key
    UNIQUE NULLS NOT DISTINCT (company_id, opening_event_id)
);

CREATE UNIQUE INDEX cash_shift_active_device_key
  ON pos.cash_shift (company_id, device_id)
  WHERE status IN ('open', 'close_requested');
CREATE UNIQUE INDEX cash_shift_active_cashier_key
  ON pos.cash_shift (company_id, cashier_user_id)
  WHERE status IN ('open', 'close_requested');
CREATE INDEX cash_shift_cashier_opened_at_idx
  ON pos.cash_shift (company_id, cashier_user_id, opened_at DESC);

CREATE TRIGGER cash_shift_immutable
  BEFORE UPDATE OR DELETE ON pos.cash_shift
  FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_change();

ALTER TABLE pos.cash_shift ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos.cash_shift FORCE ROW LEVEL SECURITY;

CREATE POLICY cash_shift_self_isolation ON pos.cash_shift
  USING (
    company_id = platform.current_company_id()
    AND cashier_user_id = platform.current_actor_id()
  )
  WITH CHECK (
    company_id = platform.current_company_id()
    AND cashier_user_id = platform.current_actor_id()
  );

GRANT USAGE ON SCHEMA pos TO ledgerlite_app;
GRANT SELECT, INSERT ON pos.cash_shift TO ledgerlite_app;

COMMENT ON TABLE pos.cash_shift IS
  'Cashier custody shift; opening float is not a financial posting.';
