# Permissions and role templates — v0.1

## Authorization model

Ledger Lite uses **capabilities**, not fixed roles, for authorization. A role template is simply a starting collection of capabilities. Each capability is scoped to one of:

- **Platform:** Ledger Lite internal administration; not available to customer users in MVP.
- **Company:** applies to all branches in one tenant company.
- **Branch:** applies only to selected branch(es).
- **Own shift:** applies only to the current cashier’s active shift.

Server-side authorization is authoritative. A POS device may cache only the capabilities needed for approved offline workflows, together with their expiry and policy version.

## Role templates

| Capability group | Company owner | Accountant | Branch manager | Cashier |
| --- | --- | --- | --- | --- |
| View company/branch dashboard | Company | Company | Assigned branches | Own branch, operational only |
| Manage company legal/VAT settings | Company | View only | — | — |
| Manage branches | Company | View only | Assigned branches, operational fields only | — |
| Invite/manage users and role templates | Company | — | Assigned branches, cashier roles only | — |
| Manage POS operating policies | Company | View only | View only | — |
| Manage POS devices | Company | — | Assigned branches | — |
| Create/edit products and prices | Company | View only | Assigned branches, if granted | View/search only |
| Receive/transfer stock | Company | View only | Assigned branches | — |
| Adjust stock | Company | View only | Assigned branches, reason required | — |
| Override stock availability | Company | — | Assigned branches, reason required | — |
| Open/close own shift | — | — | Yes | Own shift |
| View/review any branch shift | Company | View only | Assigned branches | Own shift only |
| Make sale | — | — | Assigned branches | Assigned branch and active shift |
| Apply standard discount | Configurable | — | Assigned branches | Only within policy limit |
| Apply elevated discount | Company | — | Assigned branches, reason/approval | — |
| Refund a sale | Company | — | Assigned branches, reason required | Only within policy/approval limit |
| Approve cashier refund/stock override | Company | — | Assigned branches | — |
| View accounting journals | Company | Company | Assigned branches, source detail only | — |
| Post manual accounting adjustment | Company | Company, reason required | — | — |
| Configure chart/tax/fiscal periods | Company | Company | — | — |
| Close/reopen fiscal period | Company, approval required | Company, approval required | — | — |
| View financial reports/VAT summary | Company | Company | Assigned branches, operational reports only | — |
| View audit log | Company | Accounting/configuration scope | Assigned branch scope | Own-shift events only |

`—` means the template has no capability by default. “Configurable” means the capability is granted through policy rather than automatically.

## High-risk action requirements

| Action | Minimum authority | Additional controls |
| --- | --- | --- |
| Discount beyond cashier limit | Branch manager | Policy limit, reason, audit event. |
| Refund | Cashier within policy; otherwise branch manager | Original-sale reference where available, reason, audit event. |
| Offline refund | Branch manager approval by default | Locally verifiable approval, amount limit, post-sync review. |
| Negative-stock override | Branch manager | Mandatory reason and exception queue. |
| Stock adjustment | Branch manager | Adjustment reason, quantity/value, audit event. |
| Manual journal | Accountant or owner | Balanced entry, source/reference, review policy. |
| Period close/reopen | Accountant or owner | Close validation, elevated confirmation, audit event. |
| Change POS policy/tax/company details | Owner | Online only, versioned, audit event. |

## Permission evaluation rules

1. Deny by default. A user must have the requested capability and the relevant company/branch scope.
2. A user cannot grant a capability beyond their own authority.
3. Role-template changes apply prospectively; historic actions retain their recorded actor and authorization context.
4. Permission revocation takes effect on the server immediately and on POS devices at their next sync. Offline operation follows the configured grace policy and is auditable.
5. The UI hides unauthorized actions for clarity, but the server always enforces authorization.
6. Approval is a separate recorded action; a manager must not approve their own restricted cashier action where separation-of-duties policy requires another actor.

## MVP open decisions

- Which actions require two-person approval for higher-value retailers.
- The default cashier discount and offline-refund amount limits.
- Whether the manager role can edit prices directly or only request/approve a price change.
