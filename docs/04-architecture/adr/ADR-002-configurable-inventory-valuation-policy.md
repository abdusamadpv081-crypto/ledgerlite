# ADR-002: Configurable inventory valuation policy with controlled changes

**Status:** Accepted  
**Date:** 2026-07-25  
**Decision owners:** Product owner / Ledger Lite team

## Context

Retailers may account for inventory differently. Perpetual inventory provides timely margin and inventory values; periodic inventory can be simpler for an early-stage retailer. Ledger Lite must support configuration without permitting a change that rewrites historic financial statements or invents cost data.

## Decision

Each company selects an **inventory valuation policy** during setup. The policy is company-scoped, versioned, effective-dated, and attached to relevant stock/accounting events. Branches cannot override valuation method because company financial statements consolidate branches.

Release-one policy options:

| Policy | Quantity movement | Sale-time accounting | Intended use |
| --- | --- | --- |
| `perpetual_weighted_average` | Always recorded | Post cost of goods sold and inventory reduction for a sale when reliable average cost exists. | Recommended default for general retail. |
| `periodic` | Always recorded | Do not post sale-time COGS/inventory reduction; record valuation/COGS through an authorized period-end adjustment. | Simpler retailers or those without reliable item costs. |

Future options such as FIFO or specific identification require separate accounting and data-model decisions; they are not aliases for weighted average.

## Defaults and controls

- Default: `perpetual_weighted_average`.
- All companies receive the UAE retail chart accounts needed for either policy: Inventory asset, Cost of goods sold, Inventory adjustment/variance, and stock-related clearing accounts where required.
- A company may change policy only before its first posted stock valuation or sale with costing effects.
- After financial activity exists, a policy change requires an authorized effective-date change process, accountant/owner confirmation, audit record, and documented opening inventory valuation. It does not rewrite historical journals or stock costs.
- Stock quantity movement is recorded for every policy; only accounting valuation timing differs.
- A missing or invalid cost does not silently produce a guessed COGS journal. The event is marked for valuation review according to policy.

## Weighted-average rule

For `perpetual_weighted_average`, maintain a cost layer/value per product and valuation scope. The initial MVP valuation scope is **company-wide per product**, while quantities remain branch-specific. A stock receipt with reliable cost recalculates the average before later sales consume it.

```text
new average unit cost =
  (existing inventory value + received quantity × received unit cost)
  ÷ (existing quantity + received quantity)
```

Transfers between branches do not create revenue/expense; they move quantity and preserve cost. Stock adjustments require a reason and use a configured inventory adjustment account when a valuation effect is posted.

## Consequences

- Product/stock records need quantity and valuation information distinct from selling price.
- Receiving stock needs a reliable unit cost or an exception workflow.
- Perpetual sales can show estimated/actual gross margin sooner; periodic reports must communicate that COGS is not final until period close.
- Policy changes and missing-cost exceptions are first-class audit/reporting concepts.

## Deferred decisions

- Whether weighted average becomes branch-specific after MVP.
- Purchase-order, supplier, and accounts-payable workflow.
- Landed costs, serial/batch costing, write-downs, and formal stocktake valuation adjustments.
