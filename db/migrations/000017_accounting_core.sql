-- The accounting core is deliberately database-enforced. Application services
-- may create drafts and lines, but only the narrowly privileged posting
-- function can transition a balanced journal into its immutable posted state.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerlite_journal_poster') THEN
    CREATE ROLE ledgerlite_journal_poster NOLOGIN NOBYPASSRLS;
  END IF;
END;
$$;

CREATE TABLE accounting.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 240),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  effective_from date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chart_of_accounts_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT chart_of_accounts_company_version_key UNIQUE (company_id, version)
);

CREATE UNIQUE INDEX chart_of_accounts_one_active_per_company
  ON accounting.chart_of_accounts (company_id) WHERE status = 'active';

CREATE TABLE accounting.account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  chart_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[0-9A-Z][0-9A-Z._-]{1,31}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 240),
  account_type text NOT NULL
    CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  parent_account_id uuid,
  is_posting boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_normal_balance_matches_type CHECK (
    (account_type IN ('asset', 'expense') AND normal_balance = 'debit')
    OR (account_type IN ('liability', 'equity', 'revenue') AND normal_balance = 'credit')
  ),
  CONSTRAINT account_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT account_company_code_key UNIQUE (company_id, code),
  FOREIGN KEY (company_id, chart_id)
    REFERENCES accounting.chart_of_accounts(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, parent_account_id)
    REFERENCES accounting.account(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE accounting.fiscal_period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed')),
  closed_at timestamptz,
  closed_by_user_id uuid REFERENCES platform.app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_period_dates_valid CHECK (ends_on > starts_on),
  CONSTRAINT fiscal_period_closed_details CHECK (
    (status = 'closed' AND closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL)
    OR (status <> 'closed' AND closed_at IS NULL AND closed_by_user_id IS NULL)
  ),
  CONSTRAINT fiscal_period_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT fiscal_period_company_name_key UNIQUE (company_id, name),
  EXCLUDE USING gist (
    company_id WITH =,
    daterange(starts_on, ends_on, '[)') WITH &&
  )
);

CREATE TABLE accounting.journal_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  fiscal_period_id uuid NOT NULL,
  journal_date date NOT NULL,
  entry_type text NOT NULL DEFAULT 'manual' CHECK (entry_type IN ('manual', 'system')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  source_type text,
  source_id uuid,
  created_by_user_id uuid NOT NULL REFERENCES platform.app_user(id) ON DELETE RESTRICT,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_entry_posted_at_valid CHECK (
    (status = 'posted' AND posted_at IS NOT NULL)
    OR (status = 'draft' AND posted_at IS NULL)
  ),
  CONSTRAINT journal_entry_source_valid CHECK (
    (source_type IS NULL AND source_id IS NULL)
    OR (source_type IS NOT NULL AND source_id IS NOT NULL)
  ),
  CONSTRAINT journal_entry_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT journal_entry_source_key UNIQUE NULLS NOT DISTINCT (company_id, source_type, source_id),
  FOREIGN KEY (company_id, fiscal_period_id)
    REFERENCES accounting.fiscal_period(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE accounting.journal_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  account_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  debit_amount numeric(20, 6) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(20, 6) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_line_amount_side_valid CHECK (
    (debit_amount > 0 AND credit_amount = 0)
    OR (credit_amount > 0 AND debit_amount = 0)
  ),
  CONSTRAINT journal_line_number_key UNIQUE (journal_entry_id, line_number),
  FOREIGN KEY (company_id, journal_entry_id)
    REFERENCES accounting.journal_entry(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, account_id)
    REFERENCES accounting.account(company_id, id) ON DELETE RESTRICT
);

ALTER TABLE accounting.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.chart_of_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE accounting.account ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.account FORCE ROW LEVEL SECURITY;
ALTER TABLE accounting.fiscal_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.fiscal_period FORCE ROW LEVEL SECURITY;
ALTER TABLE accounting.journal_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.journal_entry FORCE ROW LEVEL SECURITY;
ALTER TABLE accounting.journal_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.journal_line FORCE ROW LEVEL SECURITY;

CREATE POLICY chart_of_accounts_tenant_isolation ON accounting.chart_of_accounts
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY account_tenant_isolation ON accounting.account
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY fiscal_period_tenant_isolation ON accounting.fiscal_period
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY journal_entry_tenant_isolation ON accounting.journal_entry
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());
CREATE POLICY journal_line_tenant_isolation ON accounting.journal_line
  USING (company_id = platform.current_company_id())
  WITH CHECK (company_id = platform.current_company_id());

CREATE OR REPLACE FUNCTION accounting.reject_posted_journal_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'posted' THEN
    RAISE EXCEPTION 'posted journal entries are immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'posted journal entries are immutable';
    END IF;
    IF NEW.status = 'posted' AND current_user <> 'ledgerlite_journal_poster' THEN
      RAISE EXCEPTION 'journal entries must be posted through accounting.post_journal_entry';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION accounting.reject_posted_journal_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_journal_entry_id uuid := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  v_status text;
BEGIN
  SELECT status INTO v_status
    FROM accounting.journal_entry WHERE id = v_journal_entry_id;
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'lines of a posted journal entry are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER journal_entry_posted_immutable
  BEFORE UPDATE OR DELETE ON accounting.journal_entry
  FOR EACH ROW EXECUTE FUNCTION accounting.reject_posted_journal_mutation();

CREATE TRIGGER journal_line_posted_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON accounting.journal_line
  FOR EACH ROW EXECUTE FUNCTION accounting.reject_posted_journal_line_mutation();

GRANT USAGE ON SCHEMA accounting TO ledgerlite_app, ledgerlite_journal_poster;
GRANT SELECT, INSERT, UPDATE, DELETE ON accounting.chart_of_accounts,
  accounting.account, accounting.fiscal_period, accounting.journal_entry,
  accounting.journal_line TO ledgerlite_app;
GRANT SELECT ON accounting.chart_of_accounts, accounting.account,
  accounting.fiscal_period, accounting.journal_entry, accounting.journal_line
  TO ledgerlite_journal_poster;
GRANT UPDATE (status, posted_at) ON accounting.journal_entry
  TO ledgerlite_journal_poster;

CREATE OR REPLACE FUNCTION accounting.assert_journal_balanced(
  p_journal_entry_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, accounting
AS $$
DECLARE
  v_journal accounting.journal_entry%ROWTYPE;
  v_period accounting.fiscal_period%ROWTYPE;
  v_line_count integer;
  v_debit_total numeric(20, 6);
  v_credit_total numeric(20, 6);
BEGIN
  SELECT * INTO v_journal
    FROM accounting.journal_entry WHERE id = p_journal_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal entry was not found';
  END IF;
  SELECT * INTO v_period
    FROM accounting.fiscal_period WHERE id = v_journal.fiscal_period_id;
  IF NOT FOUND OR v_period.status <> 'open' THEN
    RAISE EXCEPTION 'journal entry fiscal period is not open';
  END IF;
  IF v_journal.journal_date < v_period.starts_on
     OR v_journal.journal_date >= v_period.ends_on THEN
    RAISE EXCEPTION 'journal date is outside its fiscal period';
  END IF;
  SELECT count(*), COALESCE(sum(debit_amount), 0), COALESCE(sum(credit_amount), 0)
    INTO v_line_count, v_debit_total, v_credit_total
    FROM accounting.journal_line WHERE journal_entry_id = p_journal_entry_id;
  IF v_line_count < 2 OR v_debit_total <= 0 OR v_debit_total <> v_credit_total THEN
    RAISE EXCEPTION 'journal entry is not balanced';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM accounting.journal_line AS line
      JOIN accounting.account AS account ON account.id = line.account_id
     WHERE line.journal_entry_id = p_journal_entry_id
       AND (NOT account.is_active OR NOT account.is_posting)
  ) THEN
    RAISE EXCEPTION 'journal entry includes an inactive or non-posting account';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.post_journal_entry(
  p_journal_entry_id uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, accounting
AS $$
DECLARE
  v_status text;
  v_posted_at timestamptz := clock_timestamp();
BEGIN
  SELECT status INTO v_status
    FROM accounting.journal_entry
   WHERE id = p_journal_entry_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal entry was not found';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'journal entry is not a draft';
  END IF;
  PERFORM accounting.assert_journal_balanced(p_journal_entry_id);
  UPDATE accounting.journal_entry
     SET status = 'posted', posted_at = v_posted_at
   WHERE id = p_journal_entry_id;
  RETURN v_posted_at;
END;
$$;

ALTER FUNCTION accounting.assert_journal_balanced(uuid)
  OWNER TO ledgerlite_journal_poster;
ALTER FUNCTION accounting.post_journal_entry(uuid)
  OWNER TO ledgerlite_journal_poster;

REVOKE ALL ON FUNCTION accounting.assert_journal_balanced(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION accounting.post_journal_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounting.assert_journal_balanced(uuid)
  TO ledgerlite_app;
GRANT EXECUTE ON FUNCTION accounting.post_journal_entry(uuid)
  TO ledgerlite_app;

COMMENT ON FUNCTION accounting.post_journal_entry(uuid) IS
  'The only allowed path from draft to immutable posted journal state.';
