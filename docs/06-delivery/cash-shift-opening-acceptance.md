# Cash-shift opening acceptance

**Story:** US-030 Start shift
**Route:** `/pos`
**Required role:** cashier or branch manager explicitly assigned to the branch

This script validates the online cash-shift opening path. It records a
cashier's opening float and cash-custody responsibility; it does not post a
journal, accept a sale, or permit a newly offline shift opening.

## Preconditions

1. Apply migrations, start the API and web application, and use a current
   Chrome or Edge browser on HTTPS or `localhost`.
2. Complete the device, offline-authority, and cashier-PIN preparation in
   [`offline-authority-acceptance.md`](offline-authority-acceptance.md).
3. Sign in as the assigned cashier or branch manager. An owner-only account is
   intentionally not sufficient.

## Open and verify a shift

1. Open `/pos`, select the assigned company and branch, and verify **This
   browser** is **Registered** and **Offline authority** is **Ready**.
2. Verify the cashier PIN locally. The **Cashier unlock** card must show
   **Unlocked** with a bounded expiry.
3. In **Cash shift**, enter `125.50` as the opening float and choose **Open
   cash shift**.
4. Verify the status announces the opening and the **Cash shift** card shows
   **Open** with `AED 125.50` for a UAE-default company. The active-shift panel
   must show the opening time and state that the value is not a journal entry
   or sale.
5. Reload `/pos` while online, verify the cashier PIN again, and confirm that
   the same active shift is recovered from the server and cached locally.
6. In browser developer tools, inspect the `ledgerlite-pos` IndexedDB
   database. `cashierShifts` may expose routing identifiers and timestamp
   metadata, but its opening profile must be AES-GCM ciphertext; it must not
   expose a plaintext copy of the shift payload.
7. Keep the page open, disable network in browser developer tools, and confirm
   the cached active shift remains visible. Do not reload while offline: the
   application shell is not yet an offline-installed PWA.

## Negative checks

1. Before PIN verification, confirm the opening-float form is disabled.
2. Enter `1.001` and confirm browser validation prevents submission. The API
   also rejects more than two decimal places.
3. After opening a shift, do not clear the local cache. A second open attempt
   for the same cashier/device must be refused by the API's active-shift
   constraint if sent through a separate authenticated session.

## Boundary

- Opening a new shift while disconnected is intentionally unavailable until the
  POS outbox can persist an immutable `cash_shift_opened` event for safe sync.
- Checkout, sales, cash movements, closing counts, variance, approvals, and
  accounting postings remain later stories. Do not treat this page as a sales
  terminal yet.
