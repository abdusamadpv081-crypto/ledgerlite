# Ledger Lite

Ledger Lite is a UAE-first SaaS accounting and offline point-of-sale platform for small and medium general retailers with one to five branches.

The product documentation in [`docs/`](docs/README.md) is the current source of truth. Decisions are recorded before implementation and updated as the product evolves.

## Local foundation

Start the local PostgreSQL and Redis dependencies, then apply the reviewed,
tracked database migrations:

```powershell
docker compose -f infra/compose/docker-compose.yml up -d
corepack pnpm --filter @ledgerlite/db migrate
```

Run the repository quality suite before opening a pull request:

```powershell
corepack pnpm format
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
```
