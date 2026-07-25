# Repository review — 2026-07-25

## Evidence

The review covered documentation, PostgreSQL migrations and tests, API/web
scaffold code, Docker workflow, root commands, and GitHub Actions. The repaired
baseline passes:

```text
corepack pnpm format
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
```

Database integration tests prove tenant visibility, cross-company foreign-key
rejection, audit mutation denial, catalogue/policy isolation, and forced RLS.

## Resolved findings

| Finding                                                 | Resolution                                                                                                                           | Evidence  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| Inconsistent Windows/Linux line endings.                | Added repository line-ending policy.                                                                                                 | `94a4316` |
| Catalogue/policy table owners could bypass enabled RLS. | Added an additive forced-RLS migration and regression test.                                                                          | `cd452bc` |
| Root quality commands failed with Corepack's pnpm shim. | Root scripts now invoke the pinned pnpm through Corepack.                                                                            | `568996b` |
| Catalogue prototype used unvalidated/unscoped access.   | Made it explicitly opt-in local-only; validated tax/product input and tenant context now run in a transaction-local restricted role. | `6db7c76` |
| Mutable records did not maintain `updated_at`.          | Added database-managed timestamp triggers and a regression test.                                                                     | `2e26cdd` |
| Migrations had no applied-file ledger or serialization. | Added an advisory-lock runner with SHA-256 history, clean-database tests, and CI/local adoption.                                     | `770208f` |
| Static code scanning was absent.                        | Added scheduled and pull-request CodeQL analysis.                                                                                    | `e9da1a7` |
| Production dependency audit had seven advisories.       | Updated direct dependencies and pinned reviewed transitive security fixes; audit and peer checks are clean.                          | `7692b33` |
| Optional SKU schema allowed only one missing SKU.       | Replaced `NULLS NOT DISTINCT` with a partial unique index and regression coverage.                                                   | `c783308` |

## Development-only API boundary

`/api/v1/development/catalog/*` is not a production API. It is registered only
when `LEDGERLITE_ENABLE_DEVELOPMENT_CATALOG=true` and exists solely to exercise
the local database/browser path before OIDC, sessions, capabilities, and the
production data-access layer exist.

Production and shared environments must never enable this flag. Production
routes derive tenant/branch context from an authenticated server session, never
from a client-supplied company ID.

## Remaining findings and delivery order

| Priority | Required action                                                                                                                                   | Exit evidence                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| P0       | Implement OIDC adapter, server session, current actor/company context, and capability/scope guard before exposing a business API.                 | API tests deny unauthenticated and cross-company requests.                      |
| P0       | Implement the financial trust path: shifts, Dexie outbox, sync idempotency, inventory/journal transaction, and drill-down.                        | First-vertical-slice acceptance criteria and network replay demonstration pass. |
| P1       | Add an automated previous-version upgrade test.                                                                                                   | CI validates both empty and upgrade database paths.                             |
| P1       | Add API integration, web component, and Playwright trust-path tests with the related stories.                                                     | CI executes each test layer.                                                    |
| P1       | Replace the developer catalogue harness with design-system components, price/branch controls, accessibility/RTL checks, and browser E2E evidence. | US-020 acceptance review passes.                                                |
| P1       | Configure GitHub required checks, push protection, and branch protection.                                                                         | Required security and quality checks are enforced on pull requests.             |
| P2       | Add typed Drizzle schema/API client/UI package exports only with their first production consumers.                                                | Typed contract checks pass.                                                     |

## Review rules

1. A development convenience never becomes production merely by changing an environment flag.
2. Each tenant-owned table needs RLS, company-consistent references, and a negative-path integration test.
3. Every API command validates input, derives authorization on the server, sets transaction-local context, and audits sensitive actions.
4. A story is done only with acceptance evidence; a schema enabler alone is not a delivered feature.
