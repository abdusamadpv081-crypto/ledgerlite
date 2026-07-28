# Manual testing hub

This folder is the tester-facing index for Ledger Lite. It states what is
available now, the safe order in which to test it, and the boundary between a
locally saved POS event and an authoritative accounting transaction.

## Current implementation map

| Area                                                 | Ready to test                                                                                                     | Primary script                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform availability and unauthenticated boundary   | API health; protected data is refused without a session                                                           | [Manual tester guide](../06-delivery/manual-tester-guide.md#ll-t00---availability-and-session-boundary)                                                                                                                             |
| Tenant, branch, catalogue, and accounting workspaces | Provisioned owner/accountant flows; recent posted cash-sale journals after sync                                   | [Manual tester guide](../06-delivery/manual-tester-guide.md) and [accounting acceptance](../06-delivery/accounting-workspace-acceptance.md)                                                                                         |
| POS browser preparation                              | Device registration, offline authority, cashier PIN, and online shift opening                                     | [device acceptance](../06-delivery/device-registration-acceptance.md), [offline-authority acceptance](../06-delivery/offline-authority-acceptance.md), and [cash-shift acceptance](../06-delivery/cash-shift-opening-acceptance.md) |
| US-031 local cash sale                               | Branch-filtered product cache, cart, encrypted local cash-sale event, reload persistence, pending-sync visibility | [US-031 local-sale test](us-031-local-sale-outbox.md)                                                                                                                                                                               |
| US-032 cash-sale synchronization                     | Signed delivery, exact-once acknowledgement, stock movement, and cash/revenue/VAT journal posting                 | [US-032 sale-sync test](us-032-sale-sync.md)                                                                                                                                                                                        |

## Required preparation

The local API and web app can be checked without sign-in, but authenticated
functional testing needs a non-production OIDC client and assisted-provisioned
test users. Do not create a development login bypass or insert test data
directly into tenant tables.

For a self-contained local environment, use the
[local Keycloak setup](local-keycloak-setup.md). It is an HTTP, loopback-only,
development profile—not a pilot or production identity-provider design.

Prepare these test identities through the documented operator process:

| Identity              | Minimum role                   | Used for                                                                      |
| --------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| Owner                 | `owner`                        | Company, branch, product, price, and branch availability setup                |
| Cashier               | `cashier` scoped to one branch | Device, authority, PIN, shift, and local cash sale                            |
| Accountant (optional) | `accountant`                   | Finance workspace and confirmation of the posted cash-sale journal after sync |

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

US-031 captures a signed sale locally and US-032 now delivers it to the server
when the cashier selects **Sync sales**. Only a `Synced` acknowledgement means
the cash, revenue, VAT, and stock-quantity effects committed. A rejected event
remains encrypted locally and must not be treated as a sale.

The first sync path does **not** issue a UAE receipt/invoice, post COGS or
inventory value, support card payments/refunds, or close/count a shift. Those
behaviours are separate stories and their absence is expected.
