-- Offline POS catalogue and policy read model.

CREATE TABLE catalog.tax_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (length(btrim(code)) > 0),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  rate numeric(9, 6) NOT NULL CHECK (rate >= 0 AND rate <= 1),
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  CONSTRAINT tax_code_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT tax_code_company_code_effective_key UNIQUE (company_id, code, effective_from),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE catalog.product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  sku text,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  product_kind text NOT NULL DEFAULT 'stock' CHECK (product_kind IN ('stock', 'service')),
  default_tax_code_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT product_company_sku_key UNIQUE NULLS NOT DISTINCT (company_id, sku),
  FOREIGN KEY (company_id, default_tax_code_id)
    REFERENCES catalog.tax_code(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE catalog.product_barcode (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  product_id uuid NOT NULL,
  barcode text NOT NULL CHECK (length(btrim(barcode)) > 0),
  symbology text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, product_id)
    REFERENCES catalog.product(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT product_barcode_company_barcode_key UNIQUE (company_id, barcode)
);

CREATE TABLE catalog.product_branch (
  company_id uuid NOT NULL,
  product_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  is_sellable boolean NOT NULL DEFAULT true,
  reorder_point numeric(20, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, branch_id),
  FOREIGN KEY (company_id, product_id)
    REFERENCES catalog.product(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, branch_id)
    REFERENCES platform.branch(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE platform.policy_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  branch_id uuid,
  version integer NOT NULL CHECK (version > 0),
  stock_availability_mode text NOT NULL DEFAULT 'block_at_zero'
    CHECK (stock_availability_mode IN ('block_at_zero', 'warn_and_allow', 'allow_negative_without_warning')),
  manager_stock_override_allowed boolean NOT NULL DEFAULT true,
  offline_max_hours integer NOT NULL DEFAULT 72 CHECK (offline_max_hours BETWEEN 4 AND 168),
  offline_refunds_enabled boolean NOT NULL DEFAULT false,
  offline_refund_manager_approval_required boolean NOT NULL DEFAULT true,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(policy) = 'object'),
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, branch_id)
    REFERENCES platform.branch(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT policy_version_scope_version_key UNIQUE NULLS NOT DISTINCT (company_id, branch_id, version)
);

ALTER TABLE catalog.tax_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.product ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.product_barcode ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.product_branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.policy_version ENABLE ROW LEVEL SECURITY;

CREATE POLICY tax_code_tenant_isolation ON catalog.tax_code USING (company_id = platform.current_company_id()) WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY product_tenant_isolation ON catalog.product USING (company_id = platform.current_company_id()) WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY product_barcode_tenant_isolation ON catalog.product_barcode USING (company_id = platform.current_company_id()) WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY product_branch_tenant_isolation ON catalog.product_branch USING (company_id = platform.current_company_id()) WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY policy_version_tenant_isolation ON platform.policy_version USING (company_id = platform.current_company_id()) WITH CHECK (company_id = platform.current_company_id());

GRANT USAGE ON SCHEMA catalog TO ledgerlite_app;
GRANT SELECT, INSERT, UPDATE ON catalog.tax_code, catalog.product, catalog.product_barcode, catalog.product_branch TO ledgerlite_app;
GRANT SELECT, INSERT ON platform.policy_version TO ledgerlite_app;
