# ADR-011: Cash-shift opening and cash custody

**Status:** Accepted  
**Date:** 2026-07-26  
**Decision owners:** Product owner / Ledger Lite team

## Context

US-030 requires a cashier to open a shift with an opening float before a sale.
That operation establishes responsibility for a register's cash; it is not yet
a sale, receipt, expense, or accounting posting. The product needs a durable
tenant-isolated record now, while checkout, an encrypted POS outbox, cash
movements, and shift close are still separate slices.

Creating an offline-only shift before an outbox exists would create cash
responsibility that cannot be reconciled or synchronized safely. It must not
be presented as a completed offline capability.

## Decision

1. An online command opens a `pos.cash_shift` record with company, branch,
   registered device, cashier, company base currency, opening float, effective
   policy snapshot, opening time, and immutable audit evidence. The initial
   lifecycle state is `open`; close and variance states are reserved for
   US-034.
2. An opening float is a non-negative amount in the company's base currency.
   UAE pilot input accepts no more than two decimal places. It is a custody
   value, not an accounting receipt or transfer, so opening a shift creates no
   journal entry. Cash-in/out and closing variance posting will have their own
   accounting mappings.
3. The server permits one open shift per registered device and one open shift
   per cashier within a company. This prevents a shared browser or cashier
   identity from silently owning two tills. A cashier must close the existing
   shift before opening another.
4. `POST /api/v1/companies/:companyId/branches/:branchId/pos/shifts` requires
   an authenticated session, `pos.shift.operate`, a registered device assigned
   to that branch, and an `Idempotency-Key`. The command is fully tenant and
   actor scoped, returns the existing command response on a safe retry, and
   emits an audited `pos.cash_shift.opened` event.
5. Row-level security exposes a cashier only to their own company shifts. The
   opening identity, scope, currency, float, and policy snapshot are immutable.
   Future close operations may change only explicitly guarded lifecycle fields.
6. The initial workspace may cache and display an online-opened shift, but it
   cannot open a new shift while disconnected. Offline opening is deferred
   until the encrypted immutable outbox can atomically persist a
   `cash_shift_opened` event and later receive server acknowledgement.

## Consequences

- Cashier access, device registration, operational grant, local PIN unlock,
  and a server-recorded cash shift become distinct, visible preconditions for
  checkout.
- Reporting must not infer revenue, cash-on-hand, or a journal entry merely
  from an opening float.
- A later synchronization path must verify the offline grant, policy snapshot,
  event identity, device sequence, and no-conflicting-open-shift rule before
  accepting an offline shift-open event.
- Cash-shift supervision, handover, cash movements, count/close, variance,
  manager approval, and accounting postings remain deferred rather than being
  hidden inside this small foundation.
