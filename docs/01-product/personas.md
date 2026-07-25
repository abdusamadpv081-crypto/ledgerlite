# Core personas — v0.1

These are role-based personas for the MVP, not fictional demographic profiles. One person may hold multiple roles in a small retailer, but their permissions and workflows remain distinct.

## 1. Company owner

**Primary goal:** understand and control the business across branches without becoming an accounting expert.

**Responsibilities:** company setup, branch and staff oversight, subscription ownership, review of sales and financial health.

**Needs:** a trustworthy high-level dashboard; branch comparisons; explicit alerts for failed sync, cash variances, and actions needing approval; confidence that staff cannot access inappropriate data.

**Key actions:** set up company/branches, invite managers, review sales/P&L/cash variance, approve permissions and high-risk configuration changes.

**Permission baseline:** full company access except technical platform administration.

## 2. Accountant / bookkeeper

**Primary goal:** preserve correct books and produce reliable VAT and financial reporting.

**Responsibilities:** chart of accounts, tax setup, period control, review adjustments, reconciliation, financial reporting.

**Needs:** an immutable audit trail, clear source links from reports to journals and POS events, clear status of unposted/rejected activity, and safe period close.

**Key actions:** configure accounts/taxes, review journals, record allowed adjustments, close periods, view/export VAT summary, trial balance, P&L, and balance sheet.

**Permission baseline:** accounting and reporting access across assigned branches; no routine product/catalogue or subscription access.

## 3. Branch manager

**Primary goal:** run an accurate, profitable branch and resolve daily operational exceptions.

**Responsibilities:** products/prices as authorized, staff shifts, stock control, approved returns/discounts, daily cash review.

**Needs:** a concise branch dashboard; clear stock and cash exceptions; controlled access to high-risk actions; visibility into offline device health.

**Key actions:** manage branch catalogue availability, receive/adjust stock, approve permitted refund/discount requests, review and resolve shift variance, monitor POS sync.

**Permission baseline:** limited to assigned branch(es); no cross-company accounting configuration or fiscal-period close.

## 4. Cashier

**Primary goal:** complete sales accurately and quickly, including during an internet outage.

**Responsibilities:** start/close shift, process sales/payment, issue receipts, request restricted discounts/refunds, report local device problems.

**Needs:** keyboard/scanner-first checkout, obvious price/tax/payment totals, a visible online/offline/sync status, and low-friction recovery from a mistake before payment.

**Key actions:** sign in, open shift, scan/search product, take payment, complete/print receipt, process permitted refund, count/close shift.

**Permission baseline:** assigned branch/device only; cannot alter stock, tax, journals, roles, or historical sales without an authorized workflow.

## Persona principles

- Roles are a starting point, not the authorization system. Capabilities must be individually grantable and branch-scoped.
- High-risk actions—refunds, discounts, stock adjustment, period close, and financial configuration—require explicit authority and audit history.
- The POS remains useful to the cashier offline; managerial and accounting dashboards may show cached/read-only data until online.
