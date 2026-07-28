# US-032 — cash-sale synchronization manual test

**Story status:** In progress — implementation is ready for pilot acceptance.

## Objective

Verify that an encrypted, signed local cash sale becomes authoritative exactly
once only after the server returns an acknowledgement. The accepted transaction
must append stock quantity evidence and a balanced cash/revenue/VAT journal;
an unconfirmed or rejected local event must remain visible and must not be
treated as a completed sale.

## Preconditions

1. Complete the preparation in [the testing hub](README.md), including a
   non-production OIDC user, assisted-provisioned owner and branch cashier,
   current browser-device registration, offline authority, cashier PIN, and an
   **open cash shift** in the same browser profile.
2. As owner, create the UAE retail starter chart and one open fiscal period
   covering today. The starter cash, retail-sales, and VAT-payable accounts
   must remain active and accept postings.
3. Create an active stock product with a current AED price, VAT code, and
   explicit sell-at-branch availability. Refresh the branch catalogue while
   online before simulating offline use.
4. Use a disposable non-production product. This first slice has no received
   stock workflow: its first successful stock sale is expected to display a
   stock exception because on-hand becomes negative.

Never use production credentials, a real customer, or a real payment in this
test. Record event and receipt UUIDs, but never attach PINs, cookies, offline
grants, device private keys, or IndexedDB exports to evidence.

## US32-T01 — capture a pending offline sale

1. Open `/pos` as the prepared cashier and confirm the branch catalogue,
   authority, unlocked PIN, and open shift are ready.
2. In browser developer tools, select **Offline**. Do not reload the page.
3. Add one cached stock product and select **Save local cash sale** once.
4. Record the displayed local reference and confirm the outbox row says
   `Pending sync`.

Expected:

- The sale is stored locally while disconnected and the cart clears once.
- The event remains pending after a normal page reload; re-enter the PIN if the
  page asks for it.
- No journal is posted merely by saving the local event.

## US32-T02 — synchronize and verify authoritative effects

1. Re-enable network and confirm the same pending event is visible.
2. Select **Sync sales** once. Wait for the operation to finish; do not use a
   browser refresh while the button is working.
3. Record the acknowledgement details shown in the POS outbox row.
4. Reload `/pos` and confirm the same local reference remains `Synced`, not
   `Pending sync`.
5. As the owner or accountant, open `/finance`, select **Refresh**, and locate
   the recent posted journal whose description is `POS cash sale <local receipt
UUID>`. Expand its detail.

Expected:

- The row becomes `Synced` only after a server acknowledgement. A stock product
  with no prior received quantity shows the stock-exception message; this is an
  accepted sale, not a rejection.
- The Finance workspace shows one immutable, posted system journal for the
  receipt. Its lines debit cash for the sale total and credit retail sales for
  net amount plus VAT payable for tax where applicable.
- Reloading either page does not create another POS journal. The visible local
  reference and the journal description remain stable.
- This test records stock quantity only. There is no COGS/inventory-value line
  and no UAE receipt/invoice in this slice.

## US32-T03 — safe retry after an unconfirmed delivery

1. Create a new pending local sale as in US32-T01.
2. Leave developer tools Offline and select **Sync sales**.
3. Expected: the UI reports that the sale could not be synchronized and the
   event returns to `Pending sync`; it is not deleted or marked `Synced`.
4. Re-enable network and select **Sync sales** once.
5. Reload `/pos` and `/finance`.

Expected:

- The event becomes `Synced` after the later acknowledgement.
- Exactly one recent `POS cash sale <receipt UUID>` journal exists for that
  local receipt. A transport failure must never create two postings.

## US32-T04 — rejection handling boundary

The normal cashier UI deliberately provides no unsafe way to alter a signed
event, close another shift, or bypass authority. Automated API integration
tests cover invalid signature, scope, expired/invalid grant, closed shift,
accounting configuration, duplicate acceptance, and rejection acknowledgement.

For manual exploratory testing, an operator may use a disposable environment
to close the current test shift _after_ saving a pending sale, then select
**Sync sales**. Expected: the row is retained as `Rejected` with a stable
reason; no new journal is posted. Do not perform this on a shared pilot shift.

## Pass criteria and defect evidence

US-032 manual acceptance passes when US32-T01 through US32-T03 pass and the
tester has recorded the local receipt UUID, sync outcome, and one matching
posted journal for each accepted test sale. US32-T04 is an optional
operator-assisted negative check until a safe test-only shift-close workflow
exists.

For a failure, record the test ID, browser/version, environment URL, company
and branch, timestamp in Asia/Dubai, network state, local receipt/event UUID,
expected and actual status, and a redacted screenshot or network response.
