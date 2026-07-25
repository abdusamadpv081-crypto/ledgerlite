-- Existing catalogue tables are tenant-owned. Force RLS so a non-superuser
-- migration/table owner cannot accidentally bypass the policies.

ALTER TABLE catalog.tax_code FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog.product FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog.product_barcode FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog.product_branch FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog.price_list FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog.price_list_item FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.policy_version FORCE ROW LEVEL SECURITY;
