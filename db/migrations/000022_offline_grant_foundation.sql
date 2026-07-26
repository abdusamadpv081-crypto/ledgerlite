-- Offline authority is represented by a server-issued signed grant. Persist
-- only its digest and immutable context; the signed compact grant is delivered
-- to the registered browser for disconnected verification.

ALTER TABLE platform.policy_version
  ADD CONSTRAINT policy_version_company_id_id_key UNIQUE (company_id, id);

ALTER TABLE platform.policy_version
  ADD CONSTRAINT policy_version_company_id_id_version_key
  UNIQUE (company_id, id, version);

CREATE TABLE pos.offline_grant_challenge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  device_id uuid NOT NULL,
  cashier_user_id uuid NOT NULL REFERENCES platform.app_user(id) ON DELETE RESTRICT,
  nonce_digest bytea NOT NULL CHECK (octet_length(nonce_digest) = 32),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, branch_id)
    REFERENCES platform.branch(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, device_id)
    REFERENCES platform.pos_device(company_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE TABLE pos.offline_operational_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  device_id uuid NOT NULL,
  cashier_user_id uuid NOT NULL REFERENCES platform.app_user(id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  capabilities text[] NOT NULL CHECK (cardinality(capabilities) > 0),
  token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (company_id, branch_id)
    REFERENCES platform.branch(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, device_id)
    REFERENCES platform.pos_device(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, policy_id, policy_version)
    REFERENCES platform.policy_version(company_id, id, version) ON DELETE RESTRICT,
  CHECK (expires_at > issued_at),
  CHECK (
    (revoked_at IS NULL AND revoked_reason IS NULL)
    OR (revoked_at IS NOT NULL AND length(btrim(revoked_reason)) > 0)
  )
);

CREATE INDEX offline_grant_challenge_unconsumed_idx
  ON pos.offline_grant_challenge (company_id, device_id, cashier_user_id, expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX offline_operational_grant_device_expiry_idx
  ON pos.offline_operational_grant (company_id, device_id, expires_at);
CREATE INDEX offline_operational_grant_cashier_expiry_idx
  ON pos.offline_operational_grant (company_id, cashier_user_id, expires_at);

CREATE OR REPLACE FUNCTION pos.guard_offline_grant_challenge_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL
     OR NEW.consumed_at IS NULL
     OR (to_jsonb(NEW) - 'consumed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'consumed_at') THEN
    RAISE EXCEPTION 'offline grant challenges may only be consumed once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION pos.guard_offline_operational_grant_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL
     OR NEW.revoked_at IS NULL
     OR length(btrim(COALESCE(NEW.revoked_reason, ''))) = 0
     OR (to_jsonb(NEW) - 'revoked_at' - 'revoked_reason')
       IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'revoked_reason') THEN
    RAISE EXCEPTION 'offline operational grants may only be revoked once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER offline_grant_challenge_update_guard
  BEFORE UPDATE ON pos.offline_grant_challenge
  FOR EACH ROW EXECUTE FUNCTION pos.guard_offline_grant_challenge_update();
CREATE TRIGGER offline_operational_grant_update_guard
  BEFORE UPDATE ON pos.offline_operational_grant
  FOR EACH ROW EXECUTE FUNCTION pos.guard_offline_operational_grant_update();

ALTER TABLE pos.offline_grant_challenge ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos.offline_grant_challenge FORCE ROW LEVEL SECURITY;
ALTER TABLE pos.offline_operational_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos.offline_operational_grant FORCE ROW LEVEL SECURITY;

CREATE POLICY offline_grant_challenge_tenant_isolation
  ON pos.offline_grant_challenge
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY offline_operational_grant_tenant_isolation
  ON pos.offline_operational_grant
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());

GRANT USAGE ON SCHEMA pos TO ledgerlite_app;
GRANT SELECT, INSERT, UPDATE ON pos.offline_grant_challenge,
  pos.offline_operational_grant TO ledgerlite_app;
