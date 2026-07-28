# POS cash-sale sync ledger — US-032

Migration [`000027_pos_sale_sync.sql`](../../../db/migrations/000027_pos_sale_sync.sql)
creates the first authoritative cash-sale path. A browser outbox record is
only a securely retained delivery candidate; a sale becomes authoritative only
when its transaction commits in this ledger.

## Immutable records

| Record                     | Purpose                                                                   | Important constraints                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pos.sale_event`           | Accepted signed cash-sale event and authoritative acknowledgement anchor. | Unique company receipt, company/device/cashier sequence, and tenant-scoped references to device, shift, grant, policy, and posted journal. |
| `pos.sale_line`            | Historical product, SKU, tax, price, quantity, and amount snapshot.       | One immutable line number per sale event; product/tax references must be in the same company.                                              |
| `inventory.stock_movement` | Quantity effect of each stock-product sale line.                          | One movement per sale line; negative whole-unit sale quantity; tenant-scoped branch and product references.                                |

All three tables use forced row-level security keyed to
`platform.current_company_id()`. The runtime application role receives only
the `SELECT` and `INSERT` privileges it needs. `BEFORE UPDATE OR DELETE`
triggers reject mutation, including for a table owner subject to forced RLS.

## Commit-time integrity

`pos.assert_sale_event_integrity()` is a deferred constraint trigger on
`pos.sale_event`. It runs after all rows have been assembled but before commit.
It verifies that:

- at least one sale line exists and its totals equal the event totals;
- every stock line has exactly one matching movement at the captured branch and
  time;
- `stock_exception` equals the on-hand result derived from all movements; and
- the referenced journal is a posted system journal with source
  `pos.sale` and the sale-event ID.

Therefore no committed sale event can exist without the matching commercial,
quantity, and accounting evidence. Any failed validation rolls back the entire
transaction.

## Derived stock and costing boundary

`inventory.stock_on_hand(branch_id, product_id)` is a security-invoker SQL
function. It sums the tenant's immutable quantity movements and never stores a
separate mutable stock balance. The sync service serializes a branch/product
calculation before appending a sale movement, so the stock-exception flag is
derived from a consistent order of accepted sales.

For an offline cash sale that makes on-hand negative, the transaction is still
accepted with `stock_exception = true`; it is not silently canceled after the
cashier has completed the sale. This is the recovery-safe treatment of a
completed offline event. Future policy controls may prevent further local
selling based on a prepared stock cache.

The initial ledger records no `inventory.valuation_movement` and no COGS or
inventory-value journal. US-021 must first record costed stock receipts before
the configured perpetual/periodic weighted-average policy can produce a
reliable valuation posting.

## Operational rules

- Apply the migration only through `corepack pnpm --filter @ledgerlite/db migrate`.
  The migration runner records a checksum; never edit an already-applied
  migration.
- Investigate a rejected event from its stable API rejection code and retained
  encrypted browser record. Do not insert corrective ledger rows manually.
- Correct an accepted sale through a future linked refund/correction flow, not
  by changing or deleting a ledger row.
