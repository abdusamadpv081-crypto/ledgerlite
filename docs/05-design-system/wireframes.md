# First wireframes — v0.1

These low-fidelity wireframes define hierarchy and interaction, not final visual styling. They are the first validation artifact before high-fidelity design or component implementation.

## 1. POS checkout — desktop/tablet

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Ledger Lite   Branch: Dubai Marina   Shift: #247 (Open)    ● Offline · 3 pending    [Cashier ▾]│
├───────────────────────────────────────────────────────────────┬──────────────────────────────┤
│ [ Scan barcode or search product                    ] [Search] │ CART                         │
│                                                               │  2 items                      │
│ Quick categories: [All] [Drinks] [Snacks] [Accessories]      │ ──────────────────────────── │
│                                                               │  Water 500ml            5.00 │
│ ┌───────────────────────────────────────────────────────────┐ │  [−]  2  [+]       [Remove] │
│ │ Product card                                               │ │  Energy bar             8.00 │
│ │ barcode / unit / available stock           AED 5.00 [Add]  │ │  [−]  1  [+]       [Remove] │
│ └───────────────────────────────────────────────────────────┘ │ ──────────────────────────── │
│                                                               │  Subtotal              18.00 │
│ Product grid/list; scanner focus returns to search after add  │  VAT (5%)               0.90 │
│                                                               │  TOTAL                18.90 │
│                                                               │                              │
│                                                               │  Payment: [Cash] [Card]      │
│                                                               │  [ Complete sale · AED 18.90]│
└───────────────────────────────────────────────────────────────┴──────────────────────────────┘
```

**Interaction notes:** the sync label is always readable; a pending count opens the sync centre. Barcode input holds focus during normal scan-add flow. The cart is fixed on wide layouts; on compact layouts it becomes a full-screen checkout step with a persistent total/action bar.

## 2. Sale outcome / receipt

```text
┌─────────────────────────────────────────────────────────────┐
│ ← Back to checkout                                           │
│                                                             │
│  Sale completed                                              │
│  ● Pending sync — saved securely on this device              │
│                                                             │
│  Receipt #POS-DM-000247-003                                  │
│  Cash paid                                      AED 18.90    │
│                                                             │
│  [Print receipt]  [Share receipt]  [New sale]                │
│                                                             │
│  Pending sales will sync automatically when online.          │
└─────────────────────────────────────────────────────────────┘
```

The state changes to `Synced` after acknowledgement but the receipt number/event ID remains stable. A rejected event shows the plain-language reason and route to manager/support—never a false success message.

## 3. Accounting journals — desktop

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Finance / Journals                                    [Export] [Create adjustment]            │
│ FY 2026 · Period: July (Open) · Currency: AED · Generated: 25 Jul 2026, 10:30 GST             │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Search entry, source, account...] [Date range ▾] [Branch ▾] [Status ▾] [More filters]        │
├───────┬────────────┬───────────┬──────────────────────┬──────────────┬────────────┬─────────┤
│ Date  │ Entry no.  │ Source    │ Description          │ Debit (AED)  │ Credit(AED)│ Status  │
├───────┼────────────┼───────────┼──────────────────────┼──────────────┼────────────┼─────────┤
│ 25 Jul│ JE-0001482 │ POS sale  │ Receipt #...247-003  │      18.90   │     18.90  │ Posted  │
│ 25 Jul│ JE-0001481 │ Refund    │ Receipt #...246-011  │       5.25   │      5.25  │ Posted  │
│ 24 Jul│ JE-0001480 │ Shift     │ Cash variance #246   │       3.00   │      3.00  │ Review  │
├───────┴────────────┴───────────┴──────────────────────┴──────────────┴────────────┴─────────┤
│ Showing 1–50 of 1,482                                             [‹ Previous] [Next ›]       │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Interaction notes:** selecting a row opens a detail panel with lines, actor, source receipt/shift, policy context, audit history, and linked reversal if any. System-posted records do not expose edit/delete actions. The `Create adjustment` action is permission-gated and opens a distinct controlled workflow.

## 4. Accounting journal detail

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ JE-0001482  Posted                                      [Print] [Close] │
│ POS sale · Receipt #POS-DM-000247-003 · Dubai Marina · 25 Jul 2026       │
│                                                                         │
│ Account                              Debit (AED)      Credit (AED)    │
│ Cash on hand                              18.90                 —    │
│ Retail sales revenue                         —              18.00    │
│ VAT payable                                  —               0.90    │
│ ───────────────────────────────────────────────────────────────────── │
│ Totals                                    18.90              18.90    │
│                                                                         │
│ Source event: EVT-...     Cashier: A. Khan     Policy: v3              │
│ [View receipt] [View audit history]                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

## Validation checklist

Before high-fidelity work, validate these wireframes with at least one cashier, branch manager, and accountant. Ask whether they can identify: current branch/shift, online/sync state, total/payment outcome, required next action, financial period/currency, and source of each journal without explanation.
