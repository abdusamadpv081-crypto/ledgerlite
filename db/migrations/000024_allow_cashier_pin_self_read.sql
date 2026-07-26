-- PostgreSQL requires SELECT privilege for the self-scoped UPDATE predicate.
-- RLS still permits a runtime actor to read only their own verifier record.

GRANT SELECT ON pos.cashier_pin TO ledgerlite_app;
