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

| Function                                                   | Responsibility                                                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `platform.current_company_id()`                            | Reads/validates transaction tenant context for RLS/trigger use.                                            |
| `platform.current_actor_id()`                              | Reads actor context for audit trigger/use case.                                                            |
| `audit.write_event(...)`                                   | Appends validated audit event; strips/redacts prohibited fields.                                           |
| `accounting.assert_journal_balanced(entry_id)`             | Raises exception unless debit total equals credit total and every line is valid.                           |
| `accounting.post_journal_entry(entry_id)`                  | Locks entry, checks period/account/state/balance, marks posted; cannot mutate existing posted data.        |
| `accounting.reverse_journal_entry(entry_id, reason, date)` | Creates linked opposite entry; never edits original.                                                       |
| `pos.accept_sync_event(event_id)`                          | Idempotently orchestrates server acceptance; returns existing acknowledgement for prior accepted delivery. |
| `inventory.record_stock_movement(...)`                     | Inserts immutable movement and detects policy/quantity exception.                                          |
| `inventory.apply_weighted_average(...)`                    | Applies valuation movement only when perpetual weighted-average policy and reliable cost exist.            |

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

## POS sale acceptance procedure

1. Lock/read the supplied `pos.sync_event` idempotency anchor or insert it if new.
2. If already accepted, return stored acknowledgement without another posting.
3. Validate device status, company/branch/user/shift scope, grant/policy version, schema version, and sale payload.
4. Create immutable sale, lines, and payment-attempt records.
5. Insert inventory quantity movements and valuation effects allowed by policy.
6. Build journal-entry draft/lines from the business-event mapping.
7. Call `accounting.post_journal_entry`; failure rolls back every earlier write.
8. Write audit event and stored event acknowledgement; commit.

## Reporting procedure rules

- Reports query `reporting` views built only from posted journals and accepted source events.
- Pending/rejected local POS events are excluded from official financial reports.
- Materialized views, if introduced, refresh asynchronously and display `as_of` timestamp; they never replace journal-level drill-down.
- Report exports run as background jobs and record requester, scope, criteria, generated timestamp, and file retention policy.

## Stored procedure policy

Use small, reviewed PostgreSQL functions for integrity-critical invariant checks and atomic posting. Keep workflow orchestration, permissions, integrations, user messages, and business-policy configuration in NestJS domain/application services. Do not move the full application into stored procedures.
