-- Tenant foundation: legal company, operating branch, and registered POS device.
-- The migration role owns these objects; runtime access uses ledgerlite_app and RLS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerlite_app') THEN
    CREATE ROLE ledgerlite_app NOLOGIN NOBYPASSRLS;
  END IF;
END;
$$;

CREATE TABLE platform.company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL CHECK (length(btrim(legal_name)) > 0),
  trade_name text,
  trn text,
  base_currency char(3) NOT NULL DEFAULT 'AED' CHECK (base_currency ~ '^[A-Z]{3}$'),
  time_zone text NOT NULL DEFAULT 'Asia/Dubai' CHECK (length(btrim(time_zone)) > 0),
  fiscal_year_start_month smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.branch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (length(btrim(code)) > 0),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  address jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(address) = 'object'),
  time_zone text NOT NULL DEFAULT 'Asia/Dubai' CHECK (length(btrim(time_zone)) > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT branch_company_code_key UNIQUE (company_id, code)
);

CREATE TABLE platform.pos_device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  public_key_jwk jsonb NOT NULL CHECK (jsonb_typeof(public_key_jwk) = 'object'),
  public_key_fingerprint text NOT NULL UNIQUE CHECK (length(btrim(public_key_fingerprint)) > 0),
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'suspended', 'retired')),
  app_version text,
  local_schema_version integer,
  policy_version integer,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_device_company_branch_fk
    FOREIGN KEY (company_id, branch_id)
    REFERENCES platform.branch(company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT pos_device_company_id_id_key UNIQUE (company_id, id)
);

ALTER TABLE platform.company ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.company FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.branch FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.pos_device ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.pos_device FORCE ROW LEVEL SECURITY;

CREATE POLICY company_tenant_isolation ON platform.company
  USING (id = platform.current_company_id())
  WITH CHECK (id = platform.current_company_id());

CREATE POLICY branch_tenant_isolation ON platform.branch
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());

CREATE POLICY pos_device_tenant_isolation ON platform.pos_device
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());

GRANT USAGE ON SCHEMA platform TO ledgerlite_app;
GRANT SELECT, INSERT, UPDATE ON platform.company, platform.branch, platform.pos_device TO ledgerlite_app;

COMMENT ON TABLE platform.company IS 'Tenant and legal accounting boundary.';
COMMENT ON TABLE platform.branch IS 'Tenant-owned operating location.';
COMMENT ON TABLE platform.pos_device IS 'Registered browser POS device bound to one tenant and branch.';
