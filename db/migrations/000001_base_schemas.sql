-- Ledger Lite baseline PostgreSQL objects.
-- This migration is intentionally infrastructure-only; business tables follow
-- after schema review and integration tests are in place.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS pos;
CREATE SCHEMA IF NOT EXISTS accounting;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS reporting;

CREATE OR REPLACE FUNCTION platform.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_company_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION platform.current_actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_actor_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION platform.reject_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable record % in %. cannot be updated or deleted', OLD.id, TG_TABLE_SCHEMA;
END;
$$;

COMMENT ON SCHEMA platform IS 'Tenancy, identity references, branches, devices, and policy configuration.';
COMMENT ON SCHEMA accounting IS 'Authoritative double-entry accounting ledger.';
COMMENT ON SCHEMA pos IS 'POS events, shifts, receipts, sales, and payment attempts.';
COMMENT ON SCHEMA inventory IS 'Immutable quantity and valuation movement ledgers.';
COMMENT ON SCHEMA audit IS 'Append-only audit events.';
