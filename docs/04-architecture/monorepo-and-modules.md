# Monorepo and module blueprint — v0.1

## Repository layout

```text
ledgerlite/
├── apps/
│   ├── web/                     # Next.js browser app: POS and back office
│   ├── api/                     # NestJS modular-monolith API
│   └── worker/                  # Optional BullMQ worker process; shares API modules
├── packages/
│   ├── ui/                      # Ledger Lite UI tokens, shadcn-derived primitives, domain UI
│   ├── domain/                  # Pure accounting/POS domain types, rules, Zod schemas
│   ├── api-client/              # Generated OpenAPI TypeScript client
│   ├── config/                  # TypeScript, ESLint, Vitest, Tailwind shared configuration
│   └── test-fixtures/           # Reusable test data and builders
├── infra/
│   ├── docker/                  # Local Docker images/configuration
│   ├── compose/                 # Local dependency composition
│   └── terraform/               # Environment infrastructure as code
├── docs/
├── .github/workflows/
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## Package ownership rules

| Package               | May contain                                                                  | Must not contain                                    |
| --------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| `packages/domain`     | Value objects, Zod schemas, event contracts, pure calculation/posting rules. | React, NestJS, database drivers, HTTP calls.        |
| `packages/ui`         | Tokens, shared styles, accessible primitives, Ledger Lite UI components.     | Feature-specific API calls or accounting decisions. |
| `packages/api-client` | Generated API types/client and thin client helpers.                          | Business rules or server secrets.                   |
| `apps/web`            | Routes, feature UI, POS sync worker, browser adapters.                       | Direct database access.                             |
| `apps/api`            | HTTP controllers, authorization, use cases, persistence adapters.            | UI imports and browser storage code.                |
| `apps/worker`         | Queue processors/scheduled tasks that invoke application use cases.          | Independent duplicate business logic.               |

## Backend module boundaries

```text
Platform
├── Identity & access
├── Tenancy / company / branch
├── Device management
├── Audit
├── Catalogue
├── Inventory
├── POS / shifts / receipts
├── Sync
├── Accounting / tax / periods
├── Reporting
├── Files / documents
└── Integrations
```

### Dependency direction

```text
HTTP / queue adapters
        ↓
Application use cases
        ↓
Domain rules and contracts
        ↓
Persistence / provider adapters
```

Accounting must not call the POS HTTP layer, and POS must not create journal lines directly. POS submits a validated business event to an application use case; that use case coordinates inventory, accounting, audit, and result acknowledgement within one authoritative transaction.

## First vertical slice module path

```text
Company + branch + device registration
  → product catalogue cache
  → cashier starts shift
  → device records sale in Dexie outbox
  → sync endpoint accepts/deduplicates event
  → inventory movement + balanced journal + audit event
  → acknowledgement updates POS state
  → accountant views source-linked journal
```
