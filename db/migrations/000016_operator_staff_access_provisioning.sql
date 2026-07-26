-- Extend assisted pilot operations to staff access. Runtime application users
-- must not be able to create or inspect operator tickets.

ALTER TABLE platform.role_assignment
  ADD CONSTRAINT role_assignment_company_id_id_key UNIQUE (company_id, id);

CREATE TABLE platform.staff_access_provisioning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_reference text NOT NULL UNIQUE
    CONSTRAINT staff_access_provisioning_reference_valid
    CHECK (length(btrim(external_reference)) BETWEEN 3 AND 120),
  action text NOT NULL CHECK (action IN ('grant', 'revoke')),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role_assignment_id uuid NOT NULL,
  role_template text NOT NULL
    CHECK (role_template IN ('accountant', 'branch_manager', 'cashier')),
  branch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, user_id)
    REFERENCES platform.company_user(company_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, role_assignment_id)
    REFERENCES platform.role_assignment(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, branch_id)
    REFERENCES platform.branch(company_id, id) ON DELETE RESTRICT,
  CHECK (
    (role_template = 'accountant' AND branch_id IS NULL)
    OR (role_template IN ('branch_manager', 'cashier') AND branch_id IS NOT NULL)
  )
);

GRANT SELECT, INSERT ON platform.staff_access_provisioning
  TO ledgerlite_operator;

COMMENT ON TABLE platform.staff_access_provisioning IS
  'Immutable, idempotent operator evidence for assisted pilot staff grants and revocations.';
