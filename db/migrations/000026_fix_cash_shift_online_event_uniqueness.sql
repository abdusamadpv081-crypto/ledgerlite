-- Online openings have no offline event ID. NULL event IDs must remain
-- distinct while an offline event ID is unique within its company.

ALTER TABLE pos.cash_shift
  DROP CONSTRAINT cash_shift_company_opening_event_key,
  ADD CONSTRAINT cash_shift_company_opening_event_key
    UNIQUE (company_id, opening_event_id);
