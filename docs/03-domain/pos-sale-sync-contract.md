# Cash-sale synchronization contract — v1

## Purpose

US-032 turns a browser-local cash sale into one authoritative, immutable cloud
sale. It preserves the customer-facing amounts captured while offline, accepts
the event exactly once, and creates its inventory, journal, and audit effects
in the same PostgreSQL transaction.

This contract applies only to the first cash-sale path. Card payments, refunds,
discounts, fiscal receipts, and inventory valuation are separate stories.

## Route and authority

`POST /api/v1/companies/:companyId/branches/:branchId/pos/sales/sync`

The route requires an authenticated server session, `pos.sale.create` in the
route scope, and a registered POS device. The session actor must be the
`cashierUserId` captured in the event; a manager cannot silently replay or
alter another cashier's sale.

The event's `companyId` and `branchId` must exactly match the route. The
server also verifies the referenced device, cash shift, offline operational
grant, and policy snapshot against their immutable cloud records.

## Signed event

The browser creates an immutable event before storing it in its encrypted
Dexie outbox. It contains:

```text
schemaVersion: 1                 eventType: cash_sale
eventId                           localReceiptId
localSequence                     occurredAt
companyId, branchId, deviceId     cashierUserId, shiftId
authorityGrantId                  authorityPolicyId, authorityPolicyVersion
currency                          payment (cash only)
line snapshots                    net/tax/total snapshots
deviceSignature
```

`eventId` is the event idempotency key. `localReceiptId` is distinct and is
unique per company. `localSequence` increases on one browser device/cashier
scope and is used only for retry order; it is not an accounting sequence.

The browser signs the canonical event, excluding `deviceSignature`, with its
non-exportable registered ES256/P-256 key. The exact byte payload is defined
by `posCashSaleSignaturePayload` in `@ledgerlite/domain`:

```text
ledgerlite:pos-cash-sale:v1:<canonical JSON event>
```

The context prefix prevents a valid signature for another device protocol from
being reused as a sale signature. The API obtains the registered public JWK
from PostgreSQL and verifies the raw base64url signature before any business
write. Encrypted browser storage protects data at rest; this signature is the
server-verifiable proof that binds the submitted event to the registered device.

## Acceptance and retry outcome

An acknowledgement is returned only after the database transaction commits:

```text
eventId, status, saleId, journalEntryId, localReceiptId,
acknowledgedAt, stockException?
```

| Status                          | Meaning                                                        | Browser treatment                                              |
| ------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `accepted`                      | A new event committed with all authoritative effects.          | Mark local event `synced`.                                     |
| `duplicate_accepted`            | The same event id and payload was already accepted.            | Mark local event `synced` using the original acknowledgement.  |
| `accepted_with_stock_exception` | The sale committed but drove a stock item below zero.          | Mark `synced` and show the exception to staff/support.         |
| `rejected`                      | No sale, movement, journal, or audit acceptance was committed. | Preserve local event and show a stable rejection code/message. |

If a repeated `eventId` has a different request digest or signature, it is
rejected as `EVENT_ID_PAYLOAD_MISMATCH`. A transport failure after a committed
transaction is safe: the next delivery returns the stored acknowledgement.

## Server transaction

For a first delivery, the API performs the following work in one tenant-scoped
PostgreSQL transaction:

1. Validate schema, exact decimal arithmetic, event identity, signature, route
   scope, grant capability/time window, device, and open cash shift.
2. Lock/check the event idempotency record. A prior accepted event returns its
   original result without new effects.
3. Persist the immutable sale and its line snapshots.
4. Append a negative stock movement for each stock product. On-hand is derived
   from movements, never overwritten. Concurrent sales lock each
   branch/product calculation before recording its movement.
5. Append and post one balanced system journal: debit cash for the total,
   credit retail sales for the net amount, and credit VAT payable for tax.
6. Write immutable audit evidence and the acknowledgement; update the device's
   last successful sync timestamp.

Any failure rolls back every write in this list. The browser must never infer a
successful sync from an HTTP request alone.

## Pricing, tax, and stock rules

The signed line snapshots are the historical price and tax evidence shown to
the customer while offline. The server checks their IDs belong to the tenant
and verifies the exact line/totals arithmetic; it does not replace a valid
offline price with a newer catalogue price.

The current policy has configurable stock modes. Since this first slice does
not yet cache on-hand quantity or manager overrides in the browser, a valid
offline sale that creates negative stock is **accepted with a stock exception**
rather than retroactively cancelled after the customer has paid. Future local
stock cache and manager-override work will enforce `block_at_zero` at sale
creation time. The exception retains the policy snapshot for resolution.

US-032 records quantity movements only. Sale-time COGS and inventory-value
journals are deliberately deferred until US-021 establishes costed stock
receipts and the configured periodic/perpetual weighted-average valuation
policy can be applied without guessing a cost. This does not affect the
cash/revenue/VAT journal described above.

## Stable rejection codes

| Code                                | Meaning                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `EVENT_SCHEMA_UNSUPPORTED`          | Client event version/type is not supported.                                           |
| `EVENT_SIGNATURE_INVALID`           | The signature does not verify against the registered device key.                      |
| `EVENT_SCOPE_MISMATCH`              | Route, session, event, device, grant, or shift scopes differ.                         |
| `OFFLINE_GRANT_INVALID`             | The grant is missing, revoked, expired for the event time, or lacks sale authority.   |
| `POS_SHIFT_CLOSED`                  | The captured shift is not the actor/device's open cloud shift.                        |
| `ACCOUNTING_CONFIGURATION_REQUIRED` | A valid starter chart, cash/sales/VAT accounts, or open fiscal period is unavailable. |
| `SALE_TOTAL_INVALID`                | A line, tax calculation, payment amount, or total is inconsistent.                    |
| `EVENT_ID_PAYLOAD_MISMATCH`         | An existing event ID was replayed with different signed content.                      |

Rejections are safe to retry only after the underlying cause is resolved. They
remain encrypted in the device outbox and are never silently discarded.
