# US-031 — local cash-sale outbox manual test

**Story status:** In progress — local secure capture is ready. US-032 now
synchronizes the signed event; use [US-032 sale-sync test](us-032-sale-sync.md)
for authoritative accounting and inventory acceptance.

## Objective

Verify that a cashier can prepare an offline-capable branch checkout, save a
signed cash sale locally under the required security controls, and retain the
pending event after reload before it is deliberately synchronized.

## Preconditions

1. The API and web application are running. Confirm `GET /api/v1/health`
   returns `status: "ok"`.
2. OIDC is configured for the non-production environment and an owner plus a
   branch-scoped cashier have been provisioned using assisted provisioning.
3. Sign in as the owner and create at least one active product with a current
   AED retail price and, where required, a VAT code.
4. In the catalogue workspace, set the product's branch availability to
   **Sell at this branch: Yes**. A product without explicit branch availability
   must not reach the POS catalogue.
5. Sign in as the cashier in one browser profile. Complete device
   registration, refresh offline authority, set/unlock the cashier PIN, and
   open a cash shift using the linked POS acceptance scripts.

## US31-T01 — branch catalogue is explicitly prepared

1. Open **POS access**.
2. Select the cashier's company and branch.
3. Select the refresh icon in **Branch catalogue** while online.

Expected:

- Only active products explicitly enabled for this selected branch appear.
- The message confirms the number of products encrypted for offline checkout.
- An unavailable product or a product enabled only for another branch is absent.
- Reload the page while still online; the same catalogue remains available from
  local encrypted storage.

## US31-T02 — checkout gates are enforced

1. Add a cached product to the cart.
2. Confirm the cash total updates when using the plus/minus quantity buttons.
3. Open a new POS browser profile, or use a cashier without authority/PIN/open
   shift, and repeat the step.

Expected:

- The normal cashier can only select products from the cached branch catalogue.
- `Save local cash sale` is disabled until authority, PIN unlock, and an open
  cash shift are all ready on that registered browser.
- The product price and VAT are not editable in checkout.
- Reducing quantity below one removes that line from the cart.

## US31-T03 — locally save a cash-sale event

1. With all gates ready, add one VAT-inclusive product and optionally another
   product to the cart.
2. Select **Save local cash sale** once.
3. Record the full local reference displayed in **Pending sale events**.

Expected:

- The button enters a saving state and cannot create a double click duplicate.
- The cart clears after success.
- A single event appears with `Pending sync`, amount, line count, timestamp,
  and stable local reference.
- The status text says the sale remains pending until the server acknowledges
  its journal and stock effects.

## US31-T04 — persist through reload and offline use

1. Reload the browser page.
2. Confirm the same local reference remains in **Pending sale events**.
3. After the catalogue, authority, PIN, and shift have been prepared online,
   disable the browser network in developer tools.
4. Reload the page, add a cached product, and save a local cash sale.
5. Re-enable the network and reload again.

Expected: the sale can be saved while disconnected because this step writes
only to encrypted browser storage. Re-enabling network does not silently send
or relabel it; it remains `Pending sync` until the cashier selects **Sync
sales**. Continue with US32-T02 to verify the authoritative effects.

## Negative and data-safety checks

- Do not clear site data while pending events exist. Treat that as potential
  operational data loss; record the references first.
- Verify a second browser profile cannot see the first profile's cached
  catalogue or pending sales.
- Do not attempt to edit IndexedDB records. Automated tests already verify that
  altered encrypted payloads are rejected and removed.
- Never capture or attach a POS PIN, cookie, OIDC token, signing key, or raw
  browser-storage export to a test result.

## Pass criteria

US-031 local-capture acceptance passes when US31-T01 through US31-T04 pass in
a configured test environment. The parent story remains **In progress** until
the US-032 manual acceptance, including exact-once synchronization and atomic
posting evidence, is complete.
