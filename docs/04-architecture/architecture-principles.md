# Architecture principles

## Direction

Start as a modular monolith: one deployable backend separated into strict business modules. This keeps the POS-to-accounting transaction consistent while the product is young. Extract a service only when operational evidence justifies it.

## Initial module boundaries

- Platform: tenants, companies, branches, users, permissions, subscriptions, audit.
- Accounting: accounts, journals, fiscal periods, tax, reporting.
- Catalogue: products, prices, tax classes, customers.
- Inventory: locations and stock movements.
- POS: devices, shifts, carts, sales, refunds, receipts, synchronization.
- Compliance: UAE invoice rules and future country adapters.

## Offline-first POS contract

The POS browser application retains the operational data it needs locally in Dexie/IndexedDB and writes completed sales/refunds to a durable outbox. A background sync process submits events with idempotency keys. The server validates authorization, rules, and duplicate delivery; it then posts inventory and accounting effects atomically, or rejects the event with a resolvable reason. See [ADR-003](adr/ADR-003-dexie-for-browser-local-pos-storage.md).

## Security baseline

- All data access is tenant-scoped and enforced on the server.
- Permission checks apply to every command, especially refunds, discounts, stock adjustment, and reporting.
- Sensitive actions are audited.
- Secrets are never stored in source control.
- Backups, recovery testing, and observability are first-release platform requirements, not later additions.
