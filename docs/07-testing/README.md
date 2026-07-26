# Manual testing hub

This folder is the tester-facing index for Ledger Lite. It states what is
available now, the safe order in which to test it, and the boundary between a
locally saved POS event and an authoritative accounting transaction.

## Current implementation map

| Area                                                 | Ready to test                                                                                                     | Primary script                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform availability and unauthenticated boundary   | API health; protected data is refused without a session                                                           | [Manual tester guide](../06-delivery/manual-tester-guide.md#ll-t00---availability-and-session-boundary)                                                                                                                             |
| Tenant, branch, catalogue, and accounting workspaces | Provisioned owner/accountant flows                                                                                | [Manual tester guide](../06-delivery/manual-tester-guide.md) and [accounting acceptance](../06-delivery/accounting-workspace-acceptance.md)                                                                                         |
| POS browser preparation                              | Device registration, offline authority, cashier PIN, and online shift opening                                     | [device acceptance](../06-delivery/device-registration-acceptance.md), [offline-authority acceptance](../06-delivery/offline-authority-acceptance.md), and [cash-shift acceptance](../06-delivery/cash-shift-opening-acceptance.md) |
| US-031 local cash sale                               | Branch-filtered product cache, cart, encrypted local cash-sale event, reload persistence, pending-sync visibility | [US-031 local-sale test](us-031-local-sale-outbox.md)                                                                                                                                                                               |

## Required preparation

The local API and web app can be checked without sign-in, but authenticated
functional testing needs a non-production OIDC client and assisted-provisioned
test users. Do not create a development login bypass or insert test data
directly into tenant tables.

Prepare these test identities through the documented operator process:

| Identity              | Minimum role                   | Used for                                                                     |
| --------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| Owner                 | `owner`                        | Company, branch, product, price, and branch availability setup               |
| Cashier               | `cashier` scoped to one branch | Device, authority, PIN, shift, and local cash sale                           |
| Accountant (optional) | `accountant`                   | Finance workspace and confirmation that local sales have not posted journals |

Use the same browser profile for the cashier's device registration, authority,
PIN, shift, and offline sale. Changing browser profiles or clearing site data
creates a different device context and deliberately prevents access to the
encrypted local records.

## Test result recording

For every failed case, record:

- Case ID and title.
- Environment, browser/version, local or test deployment URL, and network state.
- Test identity role and company/branch (never the PIN, OIDC token, cookie, or private key).
- Exact expected and actual result.
- Local sale reference/event reference where applicable.
- Screenshots or screen recording with customer data redacted.

## Important current boundary

US-031 is **in progress**, not a complete sale workflow. A saved local cash
sale is encrypted in Dexie and visible as `Pending sync`; it does **not** yet:

- send a sale to the API;
- reduce or value stock;
- post a journal, VAT payable, or cash entry;
- issue a UAE tax invoice/receipt; or
- synchronize after connectivity returns.

Those behaviours belong to US-032 and the future atomic inventory/accounting
posting path. Their absence is expected during the US-031 test.
