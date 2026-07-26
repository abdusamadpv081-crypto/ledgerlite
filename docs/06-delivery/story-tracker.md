# Story tracker

## How to use this tracker

This is the durable view of MVP story progress. GitHub Issues/Project is the
live work queue; each issue must link back to the applicable story below.

- **Planned:** not ready to implement.
- **In progress:** one or more enabling slices are merged, but story acceptance
  criteria are not yet fully demonstrable.
- **Done:** all acceptance criteria have implementation and verification evidence.

Do not mark a story done just because its schema or a single backend component
exists.

## E01 — SaaS foundation

| Story                  | Status      | Evidence / remaining work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| US-001 Create company  | In progress | Tenant company table and RLS: `aa9934b`; audit foundation: `d451347`; assisted operator provisioning creates company, first owner, and immutable system-audit evidence atomically: `c67820a`, `5ee5e96`, `e9b3767`; guarded owner configuration read/update API with optimistic concurrency, idempotency, correlation, and immutable audit evidence: `ed5c163`, `d3e860e`. Still needs back-office UI and acceptance review.                                                                                                                                                                     |
| US-002 Manage branches | In progress | Branch table, company-consistent device binding, and RLS: `aa9934b`; assisted provisioning creates the first branch: `5ee5e96`; guarded list/read/create/update API with owner/branch-manager capability boundaries, optimistic concurrency, idempotency, and audit evidence: `ed5c163`, `d3e860e`. Still needs back-office UI and acceptance review.                                                                                                                                                                                                                                            |
| US-003 Manage access   | In progress | OIDC identity reference, membership, scoped roles, and tests: `d451347`; role-to-capability contract: `558463b`; RLS-backed capability evaluation with company/branch, disabled-user, and cross-company denial tests: `8edf9b9`; opaque server sessions, encrypted one-time OIDC PKCE transactions, and secure login/callback/logout routes: `7cb6054`, `0ff338a`, `f00120c`, `e34a3cc`, `cac1d48`; reusable session/current-actor and route-scoped capability guards: `675ca03`. Still needs access-management/onboarding API/UI and the first production business commands using those guards. |

## E02 — Accounting core

| Story                              | Status  | Evidence / blocker                                                |
| ---------------------------------- | ------- | ----------------------------------------------------------------- |
| US-010 Configure chart of accounts | Planned | Requires chart/account model and UAE starter chart.               |
| US-011 Post a journal              | Planned | Requires journals, lines, invariant functions, and posting tests. |
| US-012 Close a fiscal period       | Planned | Depends on fiscal periods and journal posting.                    |

## E03 — Product and inventory

| Story                             | Status      | Evidence / remaining work                                                                                                                                                                                                                                       |
| --------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-020 Maintain product catalogue | In progress | Tax, product, barcode, branch availability, price, policy, RLS, and catalogue database tests: `2b30585`, `cd452bc`, `b952bbd`, `c783308`. Production management API/UI, barcode workflow, branch controls, authorization, and story acceptance evidence remain. |
| US-021 Receive stock              | Planned     | Requires inventory locations and immutable stock movements.                                                                                                                                                                                                     |
| US-022 Adjust stock               | Planned     | Depends on stock movements, reason controls, and audit flow.                                                                                                                                                                                                    |

## E04 — Offline POS

| Story                                   | Status  | Evidence / blocker                                                                  |
| --------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| US-030 Start shift                      | Planned | Depends on device, access, product/policy cache, and cash-shift model.              |
| US-031 Complete offline sale            | Planned | Depends on Dexie outbox, checkout UI, prices, shifts, and local policy enforcement. |
| US-035 Record external terminal payment | Planned | Depends on POS sale/payment model.                                                  |
| US-032 Synchronize sale                 | Planned | Depends on idempotency, sync endpoint, inventory and journal posting.               |
| US-033 Refund sale                      | Planned | Deferred beyond the first trust path.                                               |
| US-034 Close shift                      | Planned | Depends on shifts and cash variance accounting.                                     |

## E05 — UAE compliance and reporting

| Story                              | Status  | Evidence / blocker                                    |
| ---------------------------------- | ------- | ----------------------------------------------------- |
| US-040 Produce tax receipt/invoice | Planned | Depends on sales, tax data, and receipt presentation. |
| US-041 View VAT summary            | Planned | Depends on posted journals and tax-period model.      |
| US-042 View financial statements   | Planned | Depends on posted journals and reporting views.       |
