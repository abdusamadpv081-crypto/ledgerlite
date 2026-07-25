-- Assisted pilot provisioning is an operator-only workflow. This immutable
-- record makes the external operations reference idempotent and traceable;
-- it is deliberately not available to the runtime application role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerlite_operator') THEN
    CREATE ROLE ledgerlite_operator NOLOGIN NOBYPASSRLS;
  END IF;
END;
$$;

GRANT ledgerlite_app TO ledgerlite_operator;
GRANT USAGE ON SCHEMA platform TO ledgerlite_operator;

CREATE TABLE platform.company_provisioning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_reference text NOT NULL UNIQUE
    CONSTRAINT company_provisioning_reference_valid
    CHECK (length(btrim(external_reference)) BETWEEN 3 AND 120),
  company_id uuid NOT NULL UNIQUE REFERENCES platform.company(id) ON DELETE RESTRICT,
  initial_branch_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES platform.app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_provisioning_initial_branch_company_fk
    FOREIGN KEY (company_id, initial_branch_id)
    REFERENCES platform.branch(company_id, id)
    ON DELETE RESTRICT
);

GRANT SELECT, INSERT ON platform.company_provisioning TO ledgerlite_operator;

COMMENT ON TABLE platform.company_provisioning IS
  'Immutable operator evidence for idempotent assisted company/owner provisioning.';
