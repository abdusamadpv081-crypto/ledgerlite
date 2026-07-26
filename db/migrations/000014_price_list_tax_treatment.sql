-- A sale must retain whether configured prices are shelf prices that include
-- tax or net prices to which tax is added. This is a price-list property, not
-- an inferred display preference.

ALTER TABLE catalog.price_list
  ADD COLUMN tax_treatment text NOT NULL DEFAULT 'inclusive'
  CHECK (tax_treatment IN ('inclusive', 'exclusive'));

COMMENT ON COLUMN catalog.price_list.tax_treatment IS
  'Whether listed unit prices include tax (UAE retail default) or exclude tax.';
