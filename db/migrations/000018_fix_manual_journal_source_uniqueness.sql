-- Manual journals have no source event and must remain repeatable. Only
-- system journals with an actual source reference are unique per company.

ALTER TABLE accounting.journal_entry
  DROP CONSTRAINT journal_entry_source_key;

CREATE UNIQUE INDEX journal_entry_source_key
  ON accounting.journal_entry (company_id, source_type, source_id)
  WHERE source_type IS NOT NULL;
