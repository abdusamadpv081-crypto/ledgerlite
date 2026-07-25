# Database operations, backup, and recovery — v0.1

## Roles

| Role                        | Capability                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Migration role              | Applies reviewed DDL/functions/RLS changes; never used by API at runtime.                   |
| API role                    | Least-privilege access to application schemas; no schema ownership or bypass-RLS privilege. |
| Worker role                 | API-equivalent access plus only required job tables/functions.                              |
| Read-only reporting role    | Read-only reporting views; no base-table writes.                                            |
| Break-glass operations role | Time-bound, audited production support; separate credentials and approval.                  |

## Backup and recovery requirements

- Production PostgreSQL uses managed automated backups and point-in-time recovery where available.
- Backups are encrypted, retention is documented, and restoration is tested before pilot onboarding and at least quarterly thereafter.
- Recovery objectives are decided with pilot customers; initial targets are provisional until infrastructure provider selection.
- A restore test validates tenant data, journal balance, row counts, migration version, and reporting-view results.
- Browser Dexie data is never the recovery source for cloud accounting records. Unsynced device outbox recovery follows the support playbook.

## Migration procedure

1. Write an additive, reviewed SQL migration with a rollback/recovery note.
2. Test it against an empty database and a copy at the immediately previous migration version.
3. Run `corepack pnpm --filter @ledgerlite/db migrate` with the migration-role `DATABASE_URL`; it acquires a database advisory lock, records a SHA-256 checksum in `platform.schema_migration`, and rejects changed applied files.
4. Run static checks and integration tests in CI.
5. Apply to development, then staging; verify migration version, health, and critical report/query checks.
6. Promote the immutable release artifact and migration to production during approved deployment.
7. Never edit an applied migration; write a new corrective migration.

`migrate:baseline` is a one-time adoption command for a verified environment
that applied the exact reviewed migrations before the migration ledger existed.
It records checksums only after confirming the expected Ledger Lite schema is
present. It is not a recovery tool and must not be used to bypass an unknown or
failed production migration.

## Performance and maintenance

- Index tenant filter columns, source-event/idempotency keys, branch/date report filters, and foreign keys used in joins.
- Partition only after measured evidence—likely first candidates are `audit.event`, `pos.sync_event`, and eventually journal/report history by company/date.
- Monitor connection pool saturation, slow queries, lock waits, transaction rollback/error rate, replication/backup health, job failures, and database storage growth.
- Use `EXPLAIN (ANALYZE, BUFFERS)` against representative safe data before adding high-impact indexes.

## Security and audit operations

- Audit all production data access through break-glass operations role.
- Secrets live in environment secret storage, not migrations, source, or database metadata.
- Production support does not modify posted financial records. A correction is a new documented adjustment/reversal.
- Periodically test RLS tenant-isolation queries with automated negative tests.
