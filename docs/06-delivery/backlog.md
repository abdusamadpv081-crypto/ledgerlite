# MVP delivery backlog

## Priority convention

- **P0:** required to validate the first pilot.
- **P1:** important after the pilot path works.
- **P2:** deferred capability.

## Ordered backlog

| Order | Priority | Epic | First deliverable |
| --- | --- | --- | --- |
| 1 | P0 | E06 Design system | Foundations, accessibility/RTL rules, and POS/accounting screen patterns. |
| 2 | P0 | E01 SaaS foundation | Tenant, company, branch, user, permission, and audit model. |
| 3 | P0 | E02 Accounting core | Chart of accounts and invariant-protected journal posting. |
| 4 | P0 | E03 Product and inventory | Catalogue and branch stock-movement model. |
| 5 | P0 | E04 Offline POS | Offline sale, outbox/sync, payments, refunds, shifts. |
| 6 | P0 | E05 UAE compliance/reporting | UAE documents, VAT summary, and core reports. |

## Day 1 — completed documentation baseline

- [x] Confirm product, market, vertical, pricing hypothesis, and language direction.
- [x] Create BRD v0.1.
- [x] Define initial MVP epics and user stories.
- [x] Establish accounting/offline invariants.
- [x] Establish design-system principles and accessibility/RTL standards.

## Day 2 — completed discovery deliverables

- [x] Define personas and their end-to-end workflows: owner, accountant, manager, cashier.
- [x] Expand E04 into an offline POS state and sync/conflict specification.
- [x] Produce the first UX information architecture and screen inventory.

## Day 3 — proposed

- [x] Decide policy architecture: company/branch configuration, safe defaults, and audit/versioning requirements.
- [x] Decide recommended offline policy defaults: stock override, 72-hour operating window, and manager-approved offline refunds.
- [ ] Review the policy defaults with at least one prospective retailer/accountant.
- [x] Define permission capabilities, role templates, scopes, and high-risk action controls.
- [x] Produce the first accounting data model: accounts, journals, journal entries, tax, fiscal periods, and source-event links.

## Day 4 — proposed

- [ ] Decide initial inventory costing/valuation approach and document stock posting rules.
- [ ] Turn design-system principles into implementable foundations: token naming, typography scale, spacing, breakpoints, and semantic colours.
- [ ] Specify core component contracts: button, input, money input, table, status, dialog, and POS cart.
- [ ] Create the first low-fidelity POS checkout and accounting-list wireframes.
