# Business Requirements Document — Ledger Lite

**Version:** 0.1  
**Status:** Draft — discovery baseline  
**Date:** 2026-07-25  
**Product owner:** Abdusamad (to confirm)

## 1. Purpose

Ledger Lite will provide small and medium UAE general retailers with a browser-based SaaS product for point-of-sale, inventory basics, and reliable accounting. It must continue selling when the internet is unavailable and reconcile those transactions safely when connectivity returns.

## 2. Product vision

Give a retailer one trustworthy system to sell, manage branches and stock, close shifts, and understand its financial position—without needing separate POS and accounting products.

## 3. Target market

The initial customer is a UAE general retailer with one to five branches, barcode-based products, cash and card payments, and a need for simple stock control and VAT-aware accounting. The initial market is UAE; the core must support future country-specific compliance packs.

## 4. Business model

Recurring monthly SaaS subscription priced by company and number of branches. Device, user, and add-on pricing are intentionally undecided.

## 5. Release-one objectives

1. A branch can make and receipt sales while offline.
2. Once online, each locally recorded sale synchronizes exactly once and produces balanced accounting entries.
3. An authorized user can manage products, basic inventory, branches, staff permissions, and cash shifts.
4. A company can view trustworthy sales, inventory, trial balance, profit and loss, balance sheet, and VAT summary information.
5. The interface is English at launch and structurally ready for Arabic/right-to-left presentation.

## 6. MVP scope

### In scope

- Multi-tenant company, branch, user, and permission management.
- Chart of accounts, fiscal periods, double-entry journals, and audit trail.
- Products, barcode lookup, tax settings, customers, price lists, and basic stock movements.
- POS cart, cash/card payments, receipts, authorized discounts, refunds, cash shifts, and shift close.
- Offline POS sales/refunds with device-level local storage, safe sync, and visible sync state.
- UAE VAT-ready tax invoices/credit notes and core financial reports.

### Explicitly out of scope for MVP

- Restaurant/table management, kitchen display, weighing scales, pharmacy/expiry controls, manufacturing, payroll, and advanced loyalty/promotions.
- Native mobile apps, marketplace/e-commerce, bank feeds, and direct payment-terminal integration.
- Multi-country tax packs and becoming an accredited UAE e-invoicing service provider.

## 7. Functional requirements

| ID    | Requirement                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------- |
| FR-01 | The platform shall isolate each company’s data and scope users by permission and branch.          |
| FR-02 | The platform shall retain an immutable, balanced double-entry ledger for posted financial events. |
| FR-03 | A cashier shall be able to complete a sale and issue a receipt without internet connectivity.     |
| FR-04 | The platform shall synchronize offline transactions without duplicate posting.                    |
| FR-05 | The platform shall record product stock movements by branch.                                      |
| FR-06 | The platform shall create tax-aware invoices, refunds, and financial reports for UAE operations.  |
| FR-07 | The platform shall record a complete audit log for important financial and configuration actions. |

## 8. Non-functional requirements

- **Availability:** cloud services are highly available; the POS’s essential sale path remains usable offline.
- **Integrity:** money uses fixed decimal values; a posted journal must balance; posted records are not silently edited.
- **Security:** tenant isolation, least-privilege authorization, encrypted transport, and auditable privileged actions.
- **Performance:** normal POS actions feel immediate from local data; sync runs in the background.
- **Accessibility:** WCAG 2.2 AA target for browser UI.
- **Localization:** all user-facing text externalized; layouts support RTL from the component level.

## 9. Assumptions and risks

| Item                                                     | Type       | Treatment                                                                                  |
| -------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| UAE VAT and e-invoicing rules evolve                     | Risk       | Keep UAE compliance in a configurable country pack and review official guidance regularly. |
| Offline devices may send duplicate or conflicting events | Risk       | Require immutable event IDs, idempotent server processing, and explicit conflict states.   |
| Retail workflows vary widely                             | Risk       | Keep v1 limited to general retail and validate workflows with prospective users.           |
| Users may share devices                                  | Assumption | Provide device registration, cashier sign-in/out, and clear shift ownership.               |

## 10. Success measures

- A first pilot retailer completes a full day of sales and shift close without manual ledger work.
- 100% of accepted sales/refunds post balanced journals exactly once.
- An offline sale becomes synced without operator intervention after connectivity returns.
- Pilot users can complete a standard barcode sale in under 30 seconds.

## 11. Decisions still required

- Product owner and delivery team roles.
- Subscription price points and trial/onboarding model.
- Payment-terminal and printer hardware priorities.
- Whether Arabic is a launch deliverable or a post-launch translation.
- Pilot customer(s), pilot timeline, and data residency/hosting preference.
