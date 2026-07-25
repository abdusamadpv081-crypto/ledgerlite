# First vertical slice — engineering plan

## Objective

Prove the critical trust path from browser POS activity to authoritative accounting:

```text
Create company → create branch/product/device → open shift → local sale
→ durable Dexie outbox → server sync → inventory + balanced journal + audit
→ synced receipt → accountant journal drill-down
```

## Slice acceptance criteria

1. A newly created company is isolated from every other tenant.
2. A registered device downloads only its assigned branch’s permitted catalogue/policies.
3. A cashier can open a shift and make a cash sale with no network connection after initial setup.
4. The sale receives a stable local event/receipt ID and survives application refresh.
5. Re-sending the exact event creates one, and only one, accepted cloud sale/journal/inventory effect.
6. The cloud posts a balanced journal: debit cash; credit revenue and VAT payable as applicable.
7. The device displays `Synced` only after acknowledgement; rejected events remain visible with a reason.
8. An accountant can open the journal and navigate to its source event/receipt.
9. Automated tests cover duplicate sync, invalid journal balance attempt, tenant isolation, and offline outbox persistence.

## Deliberately excluded

Card-terminal integration, refunds, stock costing, Arabic copy, receipt printing, bank settlement, advanced reporting, and multi-device conflict UI. They follow after the trust path works.

## Delivery order

1. Scaffold monorepo, lint/type/test conventions, local PostgreSQL/Redis, and CI.
2. Implement tenancy, branch, identity placeholder, device registration, and audit skeleton.
3. Implement catalogue/product and policy read model.
4. Implement Dexie schema/outbox plus POS sale screen skeleton.
5. Implement sync endpoint/idempotency table and atomic sale/journal posting use case.
6. Implement status UI and journal detail read model.
7. Add integration/E2E tests and demonstrate network-off/on replay.
