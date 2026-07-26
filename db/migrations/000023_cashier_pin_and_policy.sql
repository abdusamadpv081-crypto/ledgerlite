-- Cashier PINs are separate from OIDC credentials. Server hashes are retained
-- only for the cashier who owns them; browser-local offline verifiers are not
-- stored in PostgreSQL.

ALTER TABLE platform.policy_version
  ADD COLUMN pos_pin_min_length smallint NOT NULL DEFAULT 8
    CHECK (pos_pin_min_length BETWEEN 8 AND 12),
  ADD COLUMN pos_pin_max_length smallint NOT NULL DEFAULT 12
    CHECK (pos_pin_max_length BETWEEN 8 AND 16),
  ADD COLUMN offline_pin_max_failures smallint NOT NULL DEFAULT 5
    CHECK (offline_pin_max_failures BETWEEN 3 AND 10),
  ADD COLUMN offline_pin_cool_off_minutes integer NOT NULL DEFAULT 15
    CHECK (offline_pin_cool_off_minutes BETWEEN 1 AND 1440),
  ADD COLUMN offline_cashier_session_max_hours integer NOT NULL DEFAULT 12
    CHECK (offline_cashier_session_max_hours BETWEEN 1 AND 24),
  ADD CONSTRAINT policy_version_pos_pin_length_range
    CHECK (pos_pin_min_length <= pos_pin_max_length);

CREATE TABLE pos.cashier_pin (
  company_id uuid NOT NULL,
  cashier_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  algorithm text NOT NULL DEFAULT 'argon2id' CHECK (algorithm = 'argon2id'),
  parameters_version smallint NOT NULL DEFAULT 1 CHECK (parameters_version > 0),
  salt bytea NOT NULL CHECK (octet_length(salt) = 16),
  hash bytea NOT NULL CHECK (octet_length(hash) = 32),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (company_id, cashier_user_id),
  FOREIGN KEY (company_id, cashier_user_id)
    REFERENCES platform.company_user(company_id, user_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION pos.guard_cashier_pin_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.cashier_user_id IS DISTINCT FROM OLD.cashier_user_id
     OR NEW.algorithm IS DISTINCT FROM OLD.algorithm
     OR NEW.parameters_version IS DISTINCT FROM OLD.parameters_version
     OR NEW.version <> OLD.version + 1
     OR NEW.changed_at <= OLD.changed_at THEN
    RAISE EXCEPTION 'cashier PIN updates must replace the verifier with the next version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cashier_pin_update_guard
  BEFORE UPDATE ON pos.cashier_pin
  FOR EACH ROW EXECUTE FUNCTION pos.guard_cashier_pin_update();

ALTER TABLE pos.cashier_pin ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos.cashier_pin FORCE ROW LEVEL SECURITY;

CREATE POLICY cashier_pin_self_isolation ON pos.cashier_pin
  USING (
    company_id = platform.current_company_id()
    AND cashier_user_id = platform.current_actor_id()
  )
  WITH CHECK (
    company_id = platform.current_company_id()
    AND cashier_user_id = platform.current_actor_id()
  );

GRANT INSERT, UPDATE ON pos.cashier_pin TO ledgerlite_app;
