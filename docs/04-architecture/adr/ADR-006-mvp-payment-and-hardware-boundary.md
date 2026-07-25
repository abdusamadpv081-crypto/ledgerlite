# ADR-006: MVP payment and hardware boundary

**Status:** Accepted  
**Date:** 2026-07-25  
**Decision owners:** Product owner / Ledger Lite team

## Decision

The first Ledger Lite vertical slice and pilot support cash and a recorded external-card-terminal payment type. The external terminal is operated independently by the merchant/cashier; Ledger Lite does not capture card data or call the payment acquirer in this phase.

Ledger Lite uses browser print dialogue for the baseline receipt path and supports keyboard-wedge barcode scanners. Direct/silent printer access, automatic cash drawer operation, payment-terminal APIs, and offline card acceptance are excluded from the MVP and require separately certified adapters.

## Why

This permits a retailer to conduct real checkout/shift/accounting workflows while avoiding premature PCI-sensitive scope, payment-provider onboarding/certification, and hardware-specific browser compatibility risk. Accounting records card payments to a configurable payment-clearing account, making later acquirer settlement/reconciliation possible.

## Payment states

| Payment method | MVP state source | Offline permitted | Meaning |
| --- | --- | --- | --- |
| Cash | POS cash count | Yes | Cash received by cashier; subject to shift reconciliation. |
| External terminal card | Cashier merchant-attestation | Only when terminal/provider independently confirms payment | Card processed outside Ledger Lite; terminal reference may be recorded. |
| Integrated terminal | Future provider adapter | Not in MVP | Provider response is authoritative. |
| Offline card | Future provider/terminal feature | Not in MVP | Requires explicit risk/limits/reconciliation design. |

## Required controls

- Never collect/store/log PAN, CVV, PIN, card track data, or terminal secrets.
- Require payment method and amount confirmation before completing a sale.
- Capture an optional/required provider terminal reference according to retailer policy, without storing sensitive card data.
- Produce a clear receipt that identifies payment method and Ledger Lite sale/receipt ID.
- Record every payment/refund/void against its sale and accounting source event.
- Configure external card payment postings to a payment-clearing account, not directly to bank.

## Future integration gate

Before selecting an integrated UAE acquirer/terminal provider, complete the due-diligence checklist in [UAE payments and hardware research](../../01-product/uae-payments-and-hardware-research.md), execute a sandbox proof of concept, and add a provider-specific ADR/adapter contract.
