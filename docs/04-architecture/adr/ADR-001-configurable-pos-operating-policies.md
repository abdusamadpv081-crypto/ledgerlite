# ADR-001: Configurable POS operating policies with safe defaults

**Status:** Accepted  
**Date:** 2026-07-25  
**Decision owners:** Product owner / Ledger Lite team

## Context

UAE retailers have different operational tolerances for stock accuracy, network outages, and refunds. A single global rule would either prevent legitimate sales or introduce unacceptable financial and inventory risk. Ledger Lite therefore needs configurable POS policies, including offline operation, without allowing arbitrary configuration to weaken auditability or tenant security.

## Decision

POS policies are configurable at the **company level**, with an optional **branch-level override**. Product-level inventory exceptions may be added only where explicitly supported. The effective policy is versioned, distributed to registered POS devices, and stored with each locally created event.

Policy changes:

- require owner-level permission or a separately granted `manage_pos_policies` capability;
- can only take effect after cloud acknowledgement and device synchronization;
- are audit logged with prior value, new value, actor, effective time, and scope; and
- never change the policy/version attached to a historical sale or refund.

## Recommended release-one defaults

### Inventory availability

**Default:** block a cashier sale when available stock reaches zero; permit a manager-authorized override with a mandatory reason.

This protects stock accuracy while still allowing a retailer to fulfill an exceptional sale, sell display stock, or correct a late stock receipt. The manager override creates a traceable negative-stock exception for resolution.

Supported policy options:

1. `block_at_zero` — cashier cannot create negative stock; manager override may be enabled separately.
2. `warn_and_allow` — warn cashier and permit sale; intended for retailers that accept negative stock operationally.
3. `allow_negative_without_warning` — permitted only as an explicitly acknowledged advanced policy; not recommended for the initial default.

The default applies equally while offline, using the device’s last synchronized stock state. An offline sale must never be silently changed after the customer has paid; synchronization records any resulting stock exception for manager resolution.

### Offline operating window

**Default:** 72 hours from the last successful device synchronization.

Display a warning at 24 hours and an urgent warning at 48 hours. At the maximum window, the POS enters a controlled state that prevents new sales until it reconnects, unless an already-synchronized, time-bounded emergency extension was configured by an authorized owner.

The configuration should support a bounded range of **4 to 168 hours (7 days)**. A company can choose a shorter value; extending beyond 72 hours requires an explicit risk acknowledgement because unsynchronized revenue, stock, and authorization changes accumulate on the device.

This is separate from cashier authentication: the release-one default cached cashier session/shift limit is 12 hours, with offline re-entry governed by a local manager-PIN policy to be specified.

### Offline refunds

**Default:** disallow offline refunds unless a manager approves with a locally verifiable manager PIN and a mandatory reason.

This is configurable by company/branch policy. Where offline refunds are enabled, define a per-refund and per-shift amount limit, require an original receipt reference whenever possible, and flag the event for review after synchronization.

## Consequences

- The policy engine and POS cache become first-release requirements.
- Every sale/refund payload includes the effective policy version and relevant local context.
- The back office needs policy-management and exception-review screens.
- Support and reporting can explain why an event was allowed, blocked, or flagged.

## Not decided

- Exact manager-PIN verification and cache/revocation mechanics.
- Whether product-level inventory policy overrides are in MVP or follow soon after.
- Whether an emergency offline extension needs an owner-issued signed token in v1.
