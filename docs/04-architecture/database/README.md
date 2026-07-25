# Database design index

- [Database design overview](../../03-domain/database/database-design-overview.md)
- [Core data dictionary](../../03-domain/database/core-data-dictionary.md)
- [Integrity functions and procedures](integrity-functions-and-procedures.md)
- [Operations and recovery](operations-and-recovery.md)

The first executable migration is [`db/migrations/000001_base_schemas.sql`](../../../db/migrations/000001_base_schemas.sql). Later migrations will add reviewed tables, constraints, RLS policies, triggers, functions, and views in small testable increments.
