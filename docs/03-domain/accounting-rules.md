# Non-negotiable accounting and POS rules

1. Every posted financial event creates a balanced double-entry journal in a single atomic operation.
2. Amounts use fixed decimals; floating-point values must never be used for money or tax calculations.
3. A posted journal, sale, receipt, tax document, and audit event is immutable. Corrections occur through a linked reversal, credit note, refund, or adjustment.
4. Each company, branch, device, cash shift, business event, and journal has a stable unique identifier.
5. An offline POS event receives its ID before sync. The cloud accepts an event once and returns the same outcome for retries.
6. Accounting posting is server-authoritative. A local device may record a pending sale but cannot claim it is cloud-posted until acknowledged.
7. Cash shifts record opening float, expected cash, counted cash, variance, closer, and timestamps.
8. Inventory is movement-based. On-hand quantity is derived from immutable, attributable stock movements rather than overwritten balances.
9. Audit logs record actor, action, time, affected entity, and relevant before/after values; they are append-only.
10. UAE-specific tax/document rules are configuration and compliance-pack concerns, never hard-coded assumptions in the core ledger.
