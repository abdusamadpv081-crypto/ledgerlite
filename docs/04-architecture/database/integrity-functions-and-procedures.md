# Database integrity, functions, and procedures — v0.1

## Transaction boundary

The API application starts a PostgreSQL transaction for each accepted POS/financial command and sets transaction-local context:

```sql
BEGIN;
SELECT set_config('app.current_company_id', :company_id, true);
SELECT set_config('app.current_actor_id', :actor_id, true);
SELECT set_config('app.current_correlation_id', :correlation_id, true);
-- validate/use domain function, write event/inventory/journal/audit
COMMIT;
```

The application never performs a separate committed write for the event, stock effect, journal, and audit effect of one accepted command.

## Assisted pilot provisioning

The `provision:pilot-owner` operator command uses one transaction with a
transaction advisory lock keyed by the external operations reference. It
temporarily assumes `ledgerlite_operator` to read/write the immutable
provisioning record, and `ledgerlite_app` to create tenant-scoped data under
transaction-local company/actor context.

It creates the first owner identity (only when absent and active), company,
branch, membership, owner role, and `company.provisioned` audit event before
recording the provisioning reference. A unique reference makes retries
idempotent; a reference bound to a different identity fails safely. The runtime
API role cannot read or write the operator record.

## Required database functions

| Function                                                   | Responsibility                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `platform.current_company_id()`                            | Reads/validates transaction tenant context for RLS/trigger use.                                              |
| `platform.current_actor_id()`                              | Reads actor context for audit trigger/use case.                                                              |
| `audit.write_event(...)`                                   | Appends validated audit event; strips/redacts prohibited fields.                                             |
| `accounting.assert_journal_balanced(entry_id)`             | Raises exception unless debit total equals credit total and every line is valid.                             |
| `accounting.post_journal_entry(entry_id)`                  | Locks entry, checks period/account/state/balance, marks posted; cannot mutate existing posted data.          |
| `accounting.reverse_journal_entry(entry_id, reason, date)` | Creates linked opposite entry; never edits original.                                                         |
| `inventory.stock_on_hand(branch_id, product_id)`           | Returns tenant-scoped on-hand quantity derived from immutable stock movements.                               |
| `pos.assert_sale_event_integrity()`                        | Deferred commit check requiring matching lines, stock movements, stock exception, and posted source journal. |

Functions that create postings use `SECURITY INVOKER` by default and validate tenant context. Any privileged maintenance function is explicitly `SECURITY DEFINER`, has fixed `search_path`, minimal grants, and a security review.

## Triggers and constraints

| Mechanism                                      | Purpose                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `BEFORE UPDATE OR DELETE` immutability trigger | Reject mutation of posted journals/lines, accepted POS events, sales/lines, stock movements, audit events. |
| Journal-line check                             | Exactly one side is positive: `(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)`.                  |
| Journal-post trigger/function                  | Calls balance/period/account checks at posting, not per partially-built line.                              |
| Company-consistency trigger                    | Rejects cross-company foreign-key references where a simple composite FK is impractical.                   |
| Fiscal-period exclusion constraint             | Prevents overlapping date ranges for the same company.                                                     |
| Open-shift unique partial indexes              | One active shift per registered device and per cashier, including a close-requested shift.                 |
| Source-event unique index                      | Prevents duplicate system posting for a sync event.                                                        |
| Audit trigger/use-case call                    | Logs privileged configuration/role/device actions and financial corrections.                               |
| Cashier-PIN version guard                      | Allows only a new salt/hash and the next monotonically increasing PIN verifier version.                    |

`pos.cashier_pin` has forced RLS. The runtime role can access only the row
whose company and cashier user match its transaction-local tenant and actor;
there is no broad PIN-verifier read API. The server writes a salted Argon2id
result and audit metadata only. The browser-local PBKDF2 verifier, raw PIN,
and failed-attempt state do not enter PostgreSQL.

`pos.cash_shift` also has forced RLS and is self-only for the opening cashier.
Its composite device foreign key prevents a cross-branch till assignment; the
policy snapshot and opening float are immutable. Runtime access has no update
grant, and the immutable trigger is a second database boundary. The opening
float is constrained to a non-negative two-decimal custody amount and creates
no journal entry.

## Cash-shift opening procedure

1. Acquire the tenant-and-actor-scoped command idempotency anchor.
2. Lock/read the registered device in the selected branch and the company base
   currency; reject any suspended, retired, missing, or cross-branch device.
3. Read or initialize the effective policy snapshot for the branch.
4. Insert the immutable `pos.cash_shift` opening record. Partial unique indexes
   reject a second active shift for either the device or cashier.
5. Write the correlated `pos.cash_shift.opened` audit event and complete the
   idempotency response. Do not create a journal entry.

## POS cash-sale acceptance procedure

The US-032 application service holds an event-ID advisory lock before it reads
or writes. The immutable `pos.sale_event` row itself is the accepted-event
anchor; there is no mutable browser outbox state in PostgreSQL.

1. Validate the exact signed event, session actor, registered device,
   company/branch/shift scope, grant/policy version, schema version, price/tax
   snapshots, and product/tax ownership.
2. Return the original acknowledgement if the same accepted event and payload
   are retried. Reject receipt or device/cashier sequence reuse instead of
   creating a second sale.
3. Acquire branch/product advisory locks, calculate quantity on hand from
   `inventory.stock_movement`, and derive whether the completed offline sale
   creates a stock exception.
4. Create the system journal draft and call `accounting.post_journal_entry`.
   It debits cash for the total and credits sales and VAT payable for the
   captured net/tax amounts.
5. Insert `pos.sale_event`, immutable `pos.sale_line` snapshots, and one
   negative `inventory.stock_movement` for each stock line.
6. Append correlated audit evidence, update the device's successful-sync time,
   and commit. The deferred `pos.assert_sale_event_integrity()` trigger runs at
   commit and rejects a transaction lacking any required effect.

US-032 records quantity only. Cost-of-sales and inventory-value postings stay
deferred until US-021 establishes costed receipts and the configured valuation
policy can be applied without guessing a cost.

## Reporting procedure rules

- Reports query `reporting` views built only from posted journals and accepted source events.
- Pending/rejected local POS events are excluded from official financial reports.
- Materialized views, if introduced, refresh asynchronously and display `as_of` timestamp; they never replace journal-level drill-down.
- Report exports run as background jobs and record requester, scope, criteria, generated timestamp, and file retention policy.

## Stored procedure policy

Use small, reviewed PostgreSQL functions for integrity-critical invariant checks and atomic posting. Keep workflow orchestration, permissions, integrations, user messages, and business-policy configuration in NestJS domain/application services. Do not move the full application into stored procedures.
