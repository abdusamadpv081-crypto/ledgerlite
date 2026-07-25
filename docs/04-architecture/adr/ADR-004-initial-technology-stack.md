# ADR-004: Initial technology stack

**Status:** Accepted  
**Date:** 2026-07-25  
**Decision owners:** Product owner / Ledger Lite team

## Context

Ledger Lite needs a browser-based, multi-tenant accounting and POS SaaS. It must provide an offline-capable POS while preserving an authoritative cloud ledger, enable a small team to move quickly, and have a clear path to scale without premature microservices.

## Decision

Adopt a TypeScript-first modular-monolith stack for the initial product.

| Concern | Choice | Role |
| --- | --- | --- |
| Package management/monorepo | pnpm workspaces + Turborepo | Fast, shared multi-application repository. |
| Web/POS | Next.js App Router + React + TypeScript | Browser application, back-office, POS PWA shell. |
| Styling/UI | Tailwind CSS + shadcn/ui + Radix UI + Ledger Lite `packages/ui` | Accessible primitives and owned design-system components. |
| Client/server data | TanStack Query | Online server-state fetching/invalidation; not the POS ledger/outbox. |
| POS local data | Dexie over IndexedDB | Local catalogue/policy cache and durable event outbox; see ADR-003. |
| Forms/contracts | React Hook Form + Zod | Client validation and shared request/domain schemas. |
| API | NestJS on Fastify + REST/OpenAPI | Modular server application and typed public/internal API contract. |
| Database | PostgreSQL + Drizzle ORM / SQL migrations | Authoritative relational data, constraints, transactions, reporting. |
| Background work | Redis + BullMQ | Retries, scheduled reports, notifications, exports, integration work. |
| Object files | S3-compatible storage | Receipts, generated exports, attachment storage. |
| Observability | Pino structured logs + OpenTelemetry + Sentry | Diagnostics, tracing, and actionable error monitoring. |
| Testing | Vitest + Playwright + Testcontainers | Unit/domain, browser E2E, and database integration confidence. |
| Delivery | Docker + GitHub Actions + Terraform/OpenTofu | Repeatable environments and controlled deployments. |

## Architectural principles

- TypeScript is the initial primary language across browser, API, jobs, tooling, and shared domain packages.
- Start with one deployable modular monolith. Extract a service only after a measured scaling/ownership need.
- PostgreSQL is the system of record. Financial constraints belong in database transactions/constraints as well as domain code.
- Browser POS storage is operational and recoverable, never the ledger authority.
- APIs are versioned, explicitly authenticated/authorized, and documented through OpenAPI.
- Source code is framework-independent at the domain layer wherever practical.

## Deferred choices

- OIDC provider and exact staff/session authentication implementation.
- Managed-cloud vendor, region, data residency, and production S3 provider.
- UAE payment provider/terminal integration.
- Whether a standalone worker process is needed at initial deployment or activated after first queues.

## Rejected for initial release

Microservices, Kafka, Kubernetes, GraphQL, a NoSQL system of record, native mobile applications, and multiple backend languages. These add operational cost without resolving an initial validated requirement.
