# Accounting data model and posting blueprint — v0.1

## 1. Model purpose

This document defines the minimum accounting model Ledger Lite needs to support a trustworthy general-retail MVP. It is a domain blueprint, not a database schema. Implementation must preserve these relationships and invariants.

## 2. Core entity relationships

```text
Company
├── Branch
├── Fiscal year → Fiscal period
├── Chart of accounts → Account
├── Tax configuration → Tax rate / tax code
├── Journal entry → Journal line → Account
├── Business event (sale, refund, shift, stock movement)
│   └── Source link → Journal entry
└── Audit event
```

## 3. Core entities

| Entity                     | Purpose                                                          | Required concepts                                                                                               |
| -------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Company                    | Tenant legal/accounting boundary.                                | ID, legal name, currency, VAT/TRN details, fiscal-year settings, status.                                        |
| Branch                     | Operational location within a company.                           | ID, company ID, name, address, timezone, status.                                                                |
| Chart of accounts          | Company’s account structure.                                     | ID, company ID, version, effective date.                                                                        |
| Account                    | Ledger classification.                                           | ID, account code, name, type, normal balance, parent account, active status, posting allowed.                   |
| Fiscal period              | Controlled reporting period.                                     | ID, company ID, start/end dates, status: open/closing/closed.                                                   |
| Tax code/rate              | Tax treatment applied to a transaction line.                     | ID, tax code, rate, effective dates, sales/purchase tax accounts, UAE metadata.                                 |
| Business event             | Immutable operational fact.                                      | ID, event type, company/branch/device/cashier/shift IDs where applicable, occurred-at, source/version, status.  |
| Journal entry              | Balanced accounting representation of a posted event/adjustment. | ID, company ID, journal date, posting date, period ID, source event ID, status, description.                    |
| Journal line               | Debit or credit against one account.                             | ID, journal entry ID, account ID, debit amount, credit amount, currency amounts, tax/source references.         |
| Stock movement             | Immutable change of on-hand stock.                               | ID, product, branch/location, quantity delta, event ID, reason, occurred-at, valuation-policy version.          |
| Inventory valuation record | Cost/value state and supporting cost movements.                  | Product, valuation scope, quantity/value before/after, unit cost, source movement, valuation-policy version.    |
| Cash shift                 | Cash accountability unit.                                        | ID, branch/device/cashier, opening/closing times, opening float, expected cash, counted cash, variance, status. |
| Audit event                | Append-only record of important action.                          | actor, action, entity, before/after summary, timestamp, authorization/policy context.                           |

## 4. Account classifications

The initial UAE retail starter chart must contain, at minimum:

| Type      | Examples                                                              |
| --------- | --------------------------------------------------------------------- |
| Asset     | Cash on hand, card/payment clearing, bank, inventory, VAT receivable. |
| Liability | VAT payable, customer deposits, accounts payable.                     |
| Equity    | Owner capital, retained earnings.                                     |
| Revenue   | Retail sales, sales discounts/returns contra-revenue.                 |
| Expense   | Cost of goods sold, cash shortage/overage, operating expenses.        |

An account’s type and normal balance are set intentionally and cannot be changed after transactions exist without a controlled migration/adjustment process.

## 5. Journal-entry invariants

1. A posted journal belongs to exactly one company and one fiscal period.
2. Total debits equal total credits in both base currency and any required reporting currency precision.
3. Every line has exactly one posting account and a non-negative debit or credit amount; a line cannot carry both.
4. A posted journal is immutable. Corrections create a new linked reversal/adjusting journal.
5. A system-created journal has a unique source business-event reference. The same source event cannot create duplicate system journals.
6. A journal may not post to a closed period without an explicit authorized adjustment policy.
7. Journal entries, journal lines, source events, stock movements, and audit events retain creation/actor/timestamp context.

## 6. Event-to-journal posting rules

### Sale paid by cash

| Account              |       Debit |                 Credit |
| -------------------- | ----------: | ---------------------: |
| Cash on hand         | Gross total |                      — |
| Retail sales revenue |           — | Net-of-VAT sales total |
| VAT payable          |           — |              VAT total |

For the `perpetual_weighted_average` policy, if reliable cost is available, post a linked entry: debit Cost of goods sold; credit Inventory asset. Under the `periodic` policy, do not post sale-time COGS/inventory reduction; the period-end valuation workflow creates the authorized adjustment. Never invent cost values when unavailable. See [ADR-002](../04-architecture/adr/ADR-002-configurable-inventory-valuation-policy.md).

### Sale paid by card

| Account               |       Debit |                 Credit |
| --------------------- | ----------: | ---------------------: |
| Card/payment clearing | Gross total |                      — |
| Retail sales revenue  |           — | Net-of-VAT sales total |
| VAT payable           |           — |              VAT total |

Settlement later transfers the clearing balance to bank, net of payment fees where applicable.

### Refund

A refund is linked to its original sale and reverses its financial effect; it does not modify the original journal.

| Account                          |                   Debit |             Credit |
| -------------------------------- | ----------------------: | -----------------: |
| Sales returns/discounts          | Net-of-VAT refund total |                  — |
| VAT payable                      |        VAT refund total |                  — |
| Cash on hand or payment clearing |                       — | Gross refund total |

If goods are returned to sellable inventory and `perpetual_weighted_average` applies, debit Inventory asset and credit Cost of goods sold for the recorded return cost. Under `periodic`, retain the quantity movement and resolve valuation through the period-end workflow.

### Cash shift variance

At final approved shift close, compare expected and counted cash. The implementation records the configuration-defined cash handover/clearing effect and, for a variance:

| Outcome       | Debit                 | Credit              |
| ------------- | --------------------- | ------------------- |
| Cash shortage | Cash shortage expense | Cash on hand        |
| Cash overage  | Cash on hand          | Cash overage income |

The variance journal must link to the shift count, cashier, branch, reason, and approving actor where required.

### Stock movement

Every receipt, transfer, adjustment, and sale/refund produces a stock movement. Accounting effects depend on the effective company valuation policy and whether the movement has a reliable value. Quantity movement is never discarded merely because valuation is deferred.

## 7. State transitions

| Entity         | Allowed states / transition intent                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Business event | pending sync → accepted/posted, or rejected; accepted events may be corrected only by linked event.                          |
| Journal entry  | draft (manual only) → posted → reversed/adjusted by linked entry. System journals are posted atomically on event acceptance. |
| Fiscal period  | open → closing → closed; closed may be reopened only by elevated policy.                                                     |
| Cash shift     | open → close requested → approved/closed; exceptions remain linked, not erased.                                              |

## 8. Required source links

The user must be able to travel in both directions:

```text
POS receipt / stock movement / shift
        ↔ business event ↔ journal entry ↔ journal lines ↔ report drill-down
```

This is mandatory for auditability, support, and accounting reconciliation.

## 9. Inventory valuation policy

Inventory valuation is configurable per company under [ADR-002](../04-architecture/adr/ADR-002-configurable-inventory-valuation-policy.md). Release one supports `perpetual_weighted_average` (default) and `periodic`. Policy is versioned/effective-dated and cannot be retroactively changed after postings.

## 10. Decisions deferred beyond this blueprint

- Payment-acquirer settlement/reconciliation workflow.
- Multi-currency journal representation and exchange gain/loss rules.
- Supplier purchases, accounts payable, and bank reconciliation.
- Formal UAE e-invoice data model/provider integration.
