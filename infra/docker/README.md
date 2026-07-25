# Container notes

Use `infra/compose/docker-compose.yml` for local PostgreSQL and Redis after
Docker Desktop is available. It starts dependencies only; apply migrations with
the tracked runner so local behaviour matches CI:

```powershell
docker compose -f infra/compose/docker-compose.yml up -d
corepack pnpm --filter @ledgerlite/db migrate
```

Use `corepack pnpm --filter @ledgerlite/db migrate:baseline` exactly once only
when adopting the runner for a verified existing local/development database
whose Ledger Lite migrations were already applied manually. Never use the
baseline command to bypass a failed or unknown production migration.

Production images and deployment definitions are added only after the first
vertical slice runs locally.
