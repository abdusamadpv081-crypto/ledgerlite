-- SKU is optional for general retail. Preserve uniqueness only for supplied
-- values; multiple products without a SKU are valid catalogue records.

ALTER TABLE catalog.product
  DROP CONSTRAINT product_company_sku_key,
  ADD CONSTRAINT product_sku_not_blank
    CHECK (sku IS NULL OR length(btrim(sku)) > 0);

CREATE UNIQUE INDEX product_company_sku_key
  ON catalog.product (company_id, sku)
  WHERE sku IS NOT NULL;
