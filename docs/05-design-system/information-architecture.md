# Information architecture and screen inventory — v0.1

## Application areas

```text
Ledger Lite
├── POS workspace (cashier-first, branch/device scoped)
│   ├── Sign in / device readiness
│   ├── Open shift
│   ├── Checkout
│   ├── Receipts and refunds
│   ├── Close shift
│   └── Sync centre
├── Operations workspace (manager-first)
│   ├── Branch dashboard
│   ├── Products and prices
│   ├── Inventory
│   ├── Staff / permissions
│   └── Devices and shifts
├── Finance workspace (accountant/owner)
│   ├── Accounting dashboard
│   ├── Chart of accounts
│   ├── Journals
│   ├── Fiscal periods
│   ├── VAT
│   └── Financial reports
└── Company settings (owner)
    ├── Company / branches
    ├── Tax and document settings
    ├── Subscription
    └── Audit log
```

Navigation must only reveal areas permitted to the current user. A cashier should not need to navigate through accounting screens to complete a sale.

## MVP screen inventory

| ID | Screen | Primary role | Purpose |
| --- | --- | --- | --- |
| S01 | Sign in / device readiness | Cashier | Authenticate user, verify device/branch, show network/cache readiness. |
| S02 | Open shift | Cashier | Record opening float and begin a shift. |
| S03 | POS checkout | Cashier | Scan/search, cart, discount, payment, and complete sale. |
| S04 | Receipt / sale outcome | Cashier | Print/share receipt and clearly show pending-sync/final state. |
| S05 | Receipts and refund | Cashier/manager | Find original sale and process an authorized refund. |
| S06 | Close shift | Cashier/manager | Count cash, show expected versus actual, record variance. |
| S07 | Sync centre | Cashier/manager | Explain pending/rejected events and device sync health. |
| S08 | Branch dashboard | Manager | Sales, cash, stock, and sync exceptions for assigned branch. |
| S09 | Products | Manager | Create/edit products, barcode, price, tax, availability. |
| S10 | Inventory movements | Manager | Receive, transfer, adjust, and view stock movement history. |
| S11 | Company and branches | Owner | Maintain company legal/VAT data and branch settings. |
| S12 | Users and permissions | Owner/manager | Invite users and grant branch-scoped capabilities. |
| S13 | Accounting dashboard | Accountant/owner | Financial health, unreviewed exceptions, and period status. |
| S14 | Chart of accounts | Accountant | Review/manage permitted accounts. |
| S15 | Journals | Accountant | Search and inspect immutable journal entries and source links. |
| S16 | VAT summary | Accountant | Review tax-period figures and drill into supporting activity. |
| S17 | Financial reports | Accountant/owner | Trial balance, P&L, balance sheet, exports. |
| S18 | Audit log | Owner/accountant | Inspect sensitive actions and historical changes. |

## Layout patterns

- **POS checkout:** dedicated operational workspace, persistent cart/total/payment area, large primary actions, scanner/keyboard focus managed deliberately.
- **Operational/finance list views:** page title and context, filters/search, compact data table, row details, bulk actions only where safe.
- **Financial reports:** report context (company/branch/date/currency), export/print actions, drill-down paths to journal/source event, clear generated-at timestamp.
- **Exception centre:** a reusable pattern for sync, stock, cash, and accounting exceptions with severity, reason, owner, next action, and audit trail.
