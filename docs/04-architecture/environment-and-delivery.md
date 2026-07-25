# Environments and delivery — v0.1

## Environments

| Environment | Purpose                                                  | Data policy                                                  |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| Local       | Developer workflow; Dockerized PostgreSQL/Redis.         | Synthetic fixtures only.                                     |
| CI          | Automated tests, lint/type/build, migration checks, E2E. | Ephemeral synthetic data.                                    |
| Development | Shared integration environment.                          | Synthetic or approved non-production test data.              |
| Staging     | Production-like release verification.                    | Anonymized/synthetic data; no live merchant transactions.    |
| Production  | Customer operations.                                     | Encrypted customer data; controlled access/auditing/backups. |

## Delivery pipeline

```text
Pull request
  → format/lint/typecheck
  → unit and domain tests
  → API/database integration tests
  → build web/API/worker images
  → Playwright critical E2E tests
  → review + merge
  → deploy development
  → promote verified immutable artifact to staging/production
```

## Migration rules

- Database migrations are reviewed source files and run once per environment.
- Any migration affecting financial history, tenant boundaries, or large data volume needs a rollback/recovery plan and tested staging run.
- Dexie schema migrations are versioned, tested against previous local schema data, and must never silently discard unsynced outbox events.

## Operational baseline

- Structured logs include correlation ID, environment, module, tenant-safe context, and severity; never log credentials/payment secrets.
- Track API failures, job retries/dead letters, sync rejection volume, offline duration, and POS device health.
- Back up PostgreSQL and test restoration before pilot onboarding.
- Use separate least-privilege credentials/secrets per environment; no secrets in Git.

## Release safety

- Use feature flags for incomplete modules and potentially disruptive policy changes.
- Keep the first pilot cohort small and provide a support/recovery playbook for rejected sync events.
- Production deployment must include database-migration status and health checks.
