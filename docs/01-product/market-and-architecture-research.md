# Market and architecture research — POS/accounting patterns

**Date:** 2026-07-25  
**Scope:** Public product documentation from established POS and commerce platforms. This is not a claim about their private source code or infrastructure.

## Executive findings

1. Mature systems maintain a **local offline store** on the POS device, pre-load permitted operational data, and synchronize transactions after reconnection.
2. Offline mode is intentionally restricted: catalogue changes, customer management, some discounts, returns, and cloud reporting frequently remain online-only or constrained.
3. Offline card payments are a separate, risk-bearing capability from offline cash/manual payment. They require explicit enablement, per-transaction/device limits, staff permission, and post-reconnection payment states.
4. Product, inventory, payment, policy, and user data need separate synchronization treatment. Not every cloud record belongs on a device.
5. Large systems make sync health visible and provide an operational exception path, rather than treating reconnection as invisible infrastructure.

## Public benchmarks

### Shopify POS

Shopify documents that offline checkout can accept cash and configured manual payments, while product creation, customer search/editing, online inventory sync, many discounts, exchanges/returns, and other features require connectivity. It warns against logging out or powering off while holding offline orders. [Shopify offline features](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/selling-offline/offline-features)

Its optional offline-card capability is separately enabled, permission-gated, and bounded by device-daily and per-transaction limits. Such orders remain `Payment pending` until connection returns and processing succeeds; a later decline is possible. Shopify advises reconnecting quickly, ideally within 24 hours. [Shopify offline payments](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/selling-offline/offline-payments)

**Ledger Lite implication:** treat cash/manual offline sales as MVP. Do not promise offline card payment until an integrated UAE payment provider, terminal capabilities, limits, liability, and declined-payment recovery are designed. Represent payment state separately from sale/sync state.

### Microsoft Dynamics 365 Commerce

Dynamics describes a local offline database, automatic switch on data-request timeout, controlled reconnection attempts, primary-data synchronization to devices, and offline transaction upload after reconnection. It also offers an offline dashboard for device status/errors and explicitly optimizes offline databases by excluding unneeded data. [Offline POS functionality](https://learn.microsoft.com/en-us/dynamics365/commerce/dev-itpro/pos-offline-functionality) [Store Commerce capabilities](https://learn.microsoft.com/en-us/dynamics365/commerce/dev-itpro/store-commerce-capabilities)

Its return guidance illustrates the risk: an offline device may not have the latest return information and can produce a later posting error, so offline returns are limited to locally available offline transactions. [Dynamics POS returns](https://learn.microsoft.com/en-us/dynamics365/commerce/pos-returns)

**Ledger Lite implication:** synchronize a deliberately minimal device dataset; build a sync/exceptions centre; constrain offline refunds to original locally available receipts and manager approval rather than attempting universal offline returns.

### Lightspeed Retail

Lightspeed separates integrated POS sales from standalone/offline terminal payments. Its offline payment feature must be enabled while online, uses per-transaction and aggregate limits, acknowledges merchant liability for later declines/chargebacks, and cannot issue final email receipts or process cancellations/refunds until reconnection. [Lightspeed offline payments](https://retail-support.lightspeedhq.com/hc/en-us/articles/27640682216731-Processing-payments-in-standalone-and-offline-mode)

**Ledger Lite implication:** payment-terminal integration is an independent subsystem and reconciliation concern. We should not confuse an accepted local sale with a successfully captured card payment.

### Multi-location and register workflow

Shopify positions multi-location inventory synchronization, staff PINs, and physical peripherals as normal POS foundations. [Shopify POS overview](https://help.shopify.com/en/manual/sell-in-person/shopify-pos) Lightspeed centres the operational flow around opening a register, selling, taking payments, and closing the register. [Lightspeed sales screen](https://retail-support.lightspeedhq.com/hc/en-us/articles/360035206534-Using-the-Retail-POS-R-Series-Sales-screen)

**Ledger Lite implication:** the existing company → branch → device → cashier → shift model is correct. Device registration, cash shifts, receipt IDs, peripheral readiness, and branch-scoped permissions should precede advanced retail features.

## Patterns Ledger Lite will adopt

| Pattern | Ledger Lite implementation direction |
| --- | --- |
| Local operational data | IndexedDB/Dexie cache for registered device, permitted catalogue/prices, policies, shift, and immutable outbox. |
| Local-first event creation | Device creates a durable event with ID and policy version before receipt completion. |
| Server authority | Cloud validates, deduplicates, posts ledger/inventory atomically, and acknowledges; cloud reports exclude unacknowledged events by default. |
| Explicit state | Distinguish network state, sync state, sale state, and payment state. |
| Offline reduction | Permit only safe/high-value offline functions in MVP; display unavailable functionality clearly. |
| Controlled policy | Offline windows, negative-stock handling, refunds, limits, and device permissions are versioned/audited configuration. |
| Exception operations | Sync centre records rejection reason, event ID, owner, resolution, and linked corrective event. |

## Patterns we will avoid in MVP

- Claiming that all POS functions work offline.
- Treating browser cache as the accounting ledger or a substitute for cloud backup.
- Marking offline card payments as settled before provider acknowledgement.
- Changing historical sales to resolve a sync conflict.
- Distributing all customer, accounting, or company data to every POS device.

## Research limitations and follow-up

Public help documentation describes observable behavior, not internal code architecture. Before integration choices, conduct direct discovery with UAE retailers, payment providers, accountants, and printer/scanner vendors. Regulatory guidance remains a separate source of truth from competitor behavior.
