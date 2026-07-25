# Database design overview — v0.1

## Purpose and authority

PostgreSQL is Ledger Lite’s authoritative system of record. Browser Dexie storage is an operational cache/outbox only. This design supports multi-tenant accounting, POS, inventory, audit, and reporting with strong transaction boundaries.

## PostgreSQL schemas

| Schema       | Responsibility                                                                         |
| ------------ | -------------------------------------------------------------------------------------- |
| `platform`   | Tenants/companies, users, branches, devices, roles/capabilities, policy configuration. |
| `catalog`    | Products, barcodes, prices, taxes, customer references.                                |
| `inventory`  | Locations, immutable stock movements, valuation records, stock exceptions.             |
| `pos`        | Cash shifts, receipts, sales, sale lines, payment attempts, sync events.               |
| `accounting` | Chart of accounts, fiscal periods, journal entries/lines, tax periods.                 |
| `audit`      | Append-only security/configuration/business-action audit events.                       |
| `reporting`  | Read-only views/materialized views; never the source of truth.                         |

Database migrations create these schemas explicitly. Application database roles receive least-privilege access; clients never connect directly to PostgreSQL.

## Tenant isolation

- Every tenant-owned table has a non-null `company_id`.
- A foreign key ties `company_id` to `platform.company(id)`.
- Composite foreign keys include `company_id` where a cross-tenant reference could otherwise be possible.
- Application use cases set `app.current_company_id` inside every database transaction.
- PostgreSQL row-level security is enabled for tenant-owned tables as defence in depth; privileged migration/reporting roles are separate from application roles.
- All primary and externally exposed IDs currently use database-generated random UUIDv4 values (`gen_random_uuid()`); serial IDs are not exposed. A future move to time-ordered UUIDv7 requires a reviewed compatibility migration.

## Common columns and types

| Field                      | Rule                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `id`                       | UUID primary key.                                                                              |
| `company_id`               | UUID, mandatory on tenant data.                                                                |
| `created_at`, `updated_at` | `timestamptz`, always UTC. Immutable tables omit `updated_at`.                                 |
| `created_by_user_id`       | Nullable only for system/import activity; otherwise actor reference.                           |
| `occurred_at`              | Business/event time; distinct from record creation time.                                       |
| `currency_code`            | ISO 4217 uppercase char(3); company base currency is AED in UAE MVP.                           |
| `amount`                   | `numeric(20,6)`, never floating point. Display/rounding follows currency/tax policy.           |
| `quantity`                 | `numeric(20,6)`, never floating point.                                                         |
| `status`                   | Constrained text/check or PostgreSQL enum only when change frequency is low.                   |
| `metadata`                 | `jsonb` only for additive provider/device metadata; never hide core accounting fields in JSON. |

## Core relationship map

```text
Company → Branch → POS device → Cash shift → Sale → Sale line / Payment attempt
Company → Chart of accounts → Account ← Journal line ← Journal entry ← Source event
Company → Product → Barcode / Price / Tax code
Product + Branch/location ← Stock movement ← POS/inventory source event
Every sensitive/configuration event → Audit event
```

## Immutability policy

The following are append-only after posting/acceptance: POS sync events, sales, sale lines, payment attempts, stock movements, journal entries/lines, accounting-period close events, and audit events. Corrections use linked reverse/refund/adjustment records. Database triggers deny update/delete unless a tightly controlled migration/recovery role is active.

## Migration source of truth

- Hand-reviewed SQL migrations in `db/migrations/` are authoritative for constraints, functions, views, row-security policies, and triggers.
- Drizzle table definitions in `packages/db/src/` mirror the schema for typed queries; they do not replace reviewed financial SQL.
- Every migration is forward-only, numbered, documented, and tested on an empty database and a representative previous version.
