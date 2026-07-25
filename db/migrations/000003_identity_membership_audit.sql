-- Identity references, tenant membership, scoped role assignments, and audit evidence.

CREATE TABLE platform.app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_provider text NOT NULL CHECK (length(btrim(identity_provider)) > 0),
  external_subject text NOT NULL CHECK (length(btrim(external_subject)) > 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_identity_key UNIQUE (identity_provider, external_subject)
);

CREATE TABLE platform.company_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES platform.app_user(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT company_user_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT company_user_company_user_key UNIQUE (company_id, user_id)
);

CREATE TABLE platform.role_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  company_user_id uuid NOT NULL,
  branch_id uuid,
  role_template text NOT NULL CHECK (role_template IN ('owner', 'accountant', 'branch_manager', 'cashier')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  FOREIGN KEY (company_id, company_user_id)
    REFERENCES platform.company_user(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, branch_id)
    REFERENCES platform.branch(company_id, id) ON DELETE RESTRICT,
  CHECK (
    (role_template IN ('owner', 'accountant') AND branch_id IS NULL)
    OR role_template IN ('branch_manager', 'cashier')
  )
);

CREATE TABLE audit.event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES platform.app_user(id) ON DELETE RESTRICT,
  device_id uuid,
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  entity_type text NOT NULL CHECK (length(btrim(entity_type)) > 0),
  entity_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  FOREIGN KEY (company_id, device_id)
    REFERENCES platform.pos_device(company_id, id) ON DELETE RESTRICT
);

ALTER TABLE platform.company_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.company_user FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.role_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE audit.event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.event FORCE ROW LEVEL SECURITY;

CREATE POLICY company_user_tenant_isolation ON platform.company_user
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY role_assignment_tenant_isolation ON platform.role_assignment
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY audit_event_tenant_isolation ON audit.event
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());

CREATE TRIGGER audit_event_immutable
  BEFORE UPDATE OR DELETE ON audit.event
  FOR EACH ROW EXECUTE FUNCTION platform.reject_immutable_change();

GRANT USAGE ON SCHEMA audit TO ledgerlite_app;
GRANT SELECT, INSERT, UPDATE ON platform.app_user, platform.company_user, platform.role_assignment TO ledgerlite_app;
GRANT SELECT, INSERT ON audit.event TO ledgerlite_app;
