# MVP workflow maps — v0.1

## 1. Company onboarding

```text
Owner registers/signs in
  → creates company and enters legal/VAT data
  → chooses currency, fiscal year, and UAE starter chart of accounts
  → creates first branch
  → invites manager/accountant/cashier
  → configures tax, products, and POS device
  → opens first cashier shift
```

**Completion condition:** company has an active branch, authorized users, usable catalogue, and POS device ready to transact.

## 2. Standard POS sale (online or offline)

```text
Cashier signs in and opens shift
  → scans barcode or searches product
  → confirms quantity/cart and permitted discount
  → selects cash or card payment
  → confirms total
  → sale is durably recorded locally
  → receipt is issued
  → if online: sync and cloud posting are requested in background
  → if offline: sale is visibly Pending sync until acknowledged
```

**Accounting result after cloud acceptance:** debit cash/card receivable; credit sales revenue; credit VAT payable where applicable. Inventory/cost postings are applied when the configured costing model supports them.

## 3. Offline reconnect and sync

```text
Device detects connectivity
  → authenticates session/device
  → sends pending events in creation order with immutable IDs
  → server validates and deduplicates each event
  → accepted event posts atomically to inventory/accounting
  → device marks it Synced only after acknowledgement
  → rejected event remains visible as Needs attention
```

**Completion condition:** each event has a terminal state: Synced, Rejected, or Superseded by a documented correction. A timeout or retry is never treated as successful sync.

## 4. Refund

```text
Cashier locates original receipt
  → selects items/quantity and refund method
  → system checks role/approval policy
  → cashier or manager provides mandatory reason
  → refund event is recorded locally and receipt/credit note is issued
  → cloud acceptance creates linked reversal/refund accounting entries
```

**Rule:** the original sale is not deleted or changed. A refund retains the original-sale reference whenever it exists.

## 5. Shift close

```text
Cashier chooses Close shift
  → system shows expected cash and transaction summary
  → cashier counts physical cash and enters count
  → system calculates variance
  → cashier confirms and records explanation if required
  → manager reviews/approves based on policy
  → cloud posts accepted close/variance effects and preserves the audit record
```

**Offline rule:** a device may record a local close request offline, but a shift is only marked financially finalized after server acknowledgement and required approval.

## 6. Accounting review and period close

```text
Accountant reviews journals, exceptions, and VAT summary
  → resolves permitted exceptions with linked adjustments
  → reviews trial balance
  → requests period close
  → system validates close conditions and permissions
  → period is locked; later corrections use an authorized next-period adjustment
```
