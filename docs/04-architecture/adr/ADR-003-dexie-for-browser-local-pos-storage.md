# ADR-003: Use Dexie for browser-local POS storage

**Status:** Accepted  
**Date:** 2026-07-25  
**Decision owners:** Product owner / Ledger Lite team

## Context

Ledger Lite’s release-one POS must operate during temporary loss of connectivity. It needs durable browser-local storage for a registered device’s permitted catalogue, policy cache, active shift, locally completed sales/refunds, and synchronization acknowledgements.

The local database must not become an independent accounting authority or use generic replication that silently resolves financial conflicts.

## Decision

Use **Dexie** as the TypeScript wrapper over browser IndexedDB for the POS local database. The POS application uses a custom API outbox synchronization protocol; PostgreSQL in the cloud remains authoritative for accepted business events, accounting journals, inventory valuation, permissions, and reporting.

## Local data boundary

Dexie stores only the operational data required by the device:

- registered device identity, branch scope, cache/policy version, and expiry metadata;
- permitted product catalogue, barcode index, prices, tax classes, and branch availability;
- locally cached cashier authorization data subject to offline-session policy;
- active cash shift and immutable local business-event outbox;
- server acknowledgements, rejection reasons, and synchronization watermark.

Dexie does **not** store the full company ledger, all historical reporting data, unrestricted customer/company data, or the final authoritative state of financial transactions.

## Synchronization contract

1. A completed local sale/refund is written atomically to the Dexie outbox with an immutable globally unique event ID and effective policy version.
2. The UI can issue the appropriate local receipt/result, but displays the event as pending until server acknowledgement.
3. A sync worker sends events to the backend with the event ID/idempotency key.
4. The server validates the event, deduplicates retries, and atomically posts accepted inventory/accounting/audit effects in PostgreSQL.
5. The device records the acknowledgement in Dexie and marks the event `Synced`; rejected events remain durable and visible in the sync centre.

## Alternatives considered

| Alternative | Decision |
| --- | --- |
| Native IndexedDB | Rejected for MVP: unnecessarily low-level and error-prone for transactional POS storage. |
| RxDB | Deferred: its replication/conflict framework is more than the MVP needs and would not remove the need for financial-domain validation. |
| PouchDB/CouchDB | Rejected: would impose a CouchDB-oriented replication model while PostgreSQL is the cloud accounting authority. |
| ElectricSQL | Deferred for future evaluation: promising PostgreSQL sync approach, but introduces a new synchronization platform before evidence of need. |
| Browser SQLite/OPFS | Deferred: higher implementation and cross-browser testing cost for the initial local dataset. |

## Consequences

- The web application requires a versioned Dexie schema and migration tests.
- Local writes that represent one POS action use Dexie transactions.
- Sync logic is application/domain code with testable idempotency and rejection behavior.
- Browser storage eviction, device reset, and logout/revocation need explicit UX and recovery procedures.
- The application requires a service worker/PWA strategy separately; Dexie stores data but does not cache application assets.
