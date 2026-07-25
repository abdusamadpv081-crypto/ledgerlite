-- Effective-dated prices are immutable snapshots; later price changes add rows.

CREATE TABLE catalog.price_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  currency char(3) NOT NULL DEFAULT 'AED' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_list_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT price_list_company_name_effective_key UNIQUE (company_id, name, effective_from),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE catalog.price_list_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  price_list_id uuid NOT NULL,
  product_id uuid NOT NULL,
  unit_price numeric(20, 6) NOT NULL CHECK (unit_price >= 0),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, price_list_id)
    REFERENCES catalog.price_list(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, product_id)
    REFERENCES catalog.product(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT price_list_item_effective_key UNIQUE (price_list_id, product_id, effective_from),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

ALTER TABLE catalog.price_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.price_list_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY price_list_tenant_isolation ON catalog.price_list
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY price_list_item_tenant_isolation ON catalog.price_list_item
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());

GRANT SELECT, INSERT, UPDATE ON catalog.price_list, catalog.price_list_item TO ledgerlite_app;
