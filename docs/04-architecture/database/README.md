# Database design index

- [Database design overview](../../03-domain/database/database-design-overview.md)
- [Core data dictionary](../../03-domain/database/core-data-dictionary.md)
- [Integrity functions and procedures](integrity-functions-and-procedures.md)
- [POS cash-sale sync ledger](pos-sale-sync-ledger.md)
- [Operations and recovery](operations-and-recovery.md)

The first executable migration is [`db/migrations/000001_base_schemas.sql`](../../../db/migrations/000001_base_schemas.sql). Later migrations will add reviewed tables, constraints, RLS policies, triggers, functions, and views in small testable increments.

Apply migrations through the runner, not by executing source files manually:

```powershell
corepack pnpm --filter @ledgerlite/db migrate
```

The runner uses a database advisory lock and records a SHA-256 checksum for
every applied filename in `platform.schema_migration`. It rejects a changed
already-applied migration.
