# ADR-007: Configurable price tax treatment with UAE retail default

**Status:** Accepted  
**Date:** 2026-07-26  
**Decision owners:** Product owner / Ledger Lite team

## Context

Retail shelf prices in the UAE commonly show the final VAT-inclusive amount,
while some B2B and wholesale workflows quote a net price and add tax later.
Ledger Lite must calculate revenue and VAT deterministically without trying to
guess the merchant's commercial intent from a tax rate or receipt layout.

## Decision

Each `catalog.price_list` stores a `tax_treatment` setting:

| Value       | Meaning                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `inclusive` | The configured unit price is the customer-facing total before discounts; tax is derived from it. |
| `exclusive` | The configured unit price is net of tax; tax is added to derive the customer total.              |

The default is `inclusive`, matching the initial UAE general-retail pilot. The
setting is explicit on the price list so a future wholesale/B2B list can use
`exclusive` without changing retail price semantics.

## Controls and consequences

- A sale line captures the price-list ID, tax treatment, tax rate, net amount,
  tax amount, and gross amount at acceptance. Later price-list changes never
  reinterpret historic sales.
- Changing a price list's treatment is not a display-only edit. It creates a
  new effective price-list version and is audited; it does not rewrite existing
  price items or receipts.
- A product without a tax code has equal net and gross amounts under either
  treatment.
- Tax rounding and discount allocation are part of the later POS sale-posting
  contract; this decision deliberately does not use floating-point arithmetic.

## Deferred

- Country-pack defaults beyond the UAE.
- Mixed tax treatment within one price list (not supported; use separate lists).
- Customer-specific tax exemptions and price lists.
