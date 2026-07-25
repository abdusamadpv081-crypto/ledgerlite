# Core data dictionary — v0.1

This is the release-one logical schema. Columns listed as `FK` must also preserve tenant/company consistency where applicable.

## Platform

| Table | Key fields | Notes |
| --- | --- | --- |
| `platform.company` | `id`, legal name, trade name, TRN, base currency, timezone, fiscal-year start, status | Tenant/legal accounting boundary. |
| `platform.branch` | `id`, `company_id`, name, code, address, timezone, status | Operating location; branch code unique per company. |
| `platform.user` | `id`, external identity subject, display name, email, status | OIDC identity link; no password/PIN secret stored here. |
| `platform.company_user` | `company_id`, `user_id`, status, effective dates | Tenant membership. |
| `platform.role_assignment` | membership FK, role template, branch scope, effective dates | Role template maps to capabilities. |
| `platform.pos_device` | `id`, company/branch FK, public key, status, last sync, app/schema/policy version | Registered browser installation; unique public-key fingerprint. |
| `platform.policy_version` | company/branch scope, policy JSON, effective time, version | Immutable configuration snapshot referenced by local events. |

## Catalogue and tax

| Table | Key fields | Notes |
| --- | --- | --- |
| `catalog.product` | `id`, company FK, SKU, name, kind, active, default tax code | Product master; SKU unique per company when present. |
| `catalog.product_barcode` | product/company FK, barcode, symbology, active | Barcode unique per company while active. |
| `catalog.product_branch` | product/branch FK, sellable, reorder settings | Branch availability/configuration. |
| `catalog.price_list` | company FK, currency, effective dates, status | Supports future price lists. |
| `catalog.price_list_item` | price-list/product FK, unit price, effective dates | No price overwrite; new effective record. |
| `catalog.tax_code` | company FK, code, name, rate, effective dates, sales tax account FK | UAE VAT configurable data. |
| `catalog.customer` | company FK, display/legal name, contact, TRN, status | Minimal MVP customer data; not preloaded on POS offline by default. |

## POS and synchronization

| Table | Key fields | Notes |
| --- | --- | --- |
| `pos.sync_event` | `id`, company/branch/device/cashier/shift FK, event type, local sequence, occurred time, policy version, payload, result state | Immutable idempotency anchor; unique `(company_id, device_id, id)`. |
| `pos.cash_shift` | company/branch/device/cashier FK, opening float, expected/counted cash, variance, status, opened/closed time | One open shift per device; constraints enforce valid state. |
| `pos.sale` | company/branch/shift FK, receipt number, source event FK, status, totals, currency, occurred time | Created only after accepted event; source event unique. |
| `pos.sale_line` | sale/product/tax FK, quantity, unit price, discount, tax, totals | Immutable commercial line snapshot. |
| `pos.payment_attempt` | sale FK, method, amount, currency, state, external reference, provider metadata | Never includes cardholder data. |
| `pos.refund` | original sale/source event FK, status, reason, totals | Linked correction; no update of original sale. |

## Inventory

| Table | Key fields | Notes |
| --- | --- | --- |
| `inventory.location` | company/branch FK, code, name, active | Initial default sellable location per branch. |
| `inventory.stock_movement` | company/product/location/source-event FK, movement type, quantity delta, reason, occurred time, valuation policy version | Immutable quantity ledger. |
| `inventory.valuation_movement` | product/company/source stock movement FK, quantity/value delta, unit cost, valuation policy version | Cost/value ledger; supports weighted average. |
| `inventory.stock_exception` | source event/product/location FK, exception type, state, owner/reason | Negative/missing-cost/reconciliation exceptions. |

## Accounting

| Table | Key fields | Notes |
| --- | --- | --- |
| `accounting.chart_of_accounts` | company FK, name, version, effective date, status | Chart container. |
| `accounting.account` | chart/company FK, account code, name, type, normal balance, posting allowed, active | Code unique per company; account type immutable after postings. |
| `accounting.fiscal_period` | company FK, period start/end, status | Non-overlapping periods per company. |
| `accounting.journal_entry` | company/period/source-event FK, entry number, journal/posting date, status, description, reversal FK | Posted entry immutable; source event unique for system journals. |
| `accounting.journal_line` | journal/company/account FK, debit, credit, currency, exchange rate/source refs | Exactly one non-zero debit or credit; totals balance per entry. |
| `accounting.tax_period` | company/date range/status | VAT reporting grouping. |

## Audit/reporting

| Table/view | Key fields | Notes |
| --- | --- | --- |
| `audit.event` | company/actor/device FK, action, entity type/ID, occurred time, before/after summary, correlation ID | Append-only; redact secrets/sensitive values. |
| `reporting.v_trial_balance` | company/period/account aggregates | Read-only view over posted journals. |
| `reporting.v_profit_and_loss` | company/period/account aggregates | Read-only view; report layout maps account types. |
| `reporting.v_balance_sheet` | company/as-of-date/account aggregates | Read-only view. |

## Required unique/foreign-key rules

- A `pos.sync_event.id` can produce at most one accepted sale/refund and one system journal-entry source link.
- A POS receipt number is unique within its company; prefix/branch/display format is separate from the UUID identity.
- Journal lines may only reference accounts in the same company as their journal.
- Sale lines, stock movements, and journal lines retain product/account/tax descriptions needed for historical interpretation; later master-data edits do not rewrite history.
- All references from a tenant-owned table to another tenant-owned table use same-company foreign-key validation or a database function/trigger that rejects mismatch.
