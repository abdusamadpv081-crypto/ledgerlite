# Accounting workspace pilot acceptance

**Scope:** US-010, US-011, and US-012  
**Route:** `/finance`  
**Required role:** company owner or accountant provisioned through the assisted
pilot workflow.

This script is the manual acceptance evidence for the first accountant-facing
workflow. The user interface is English-first and is designed with logical CSS
layout so it remains safe to adapt for RTL later; Arabic copy is not part of
this pilot check.

## Preconditions

1. Apply the current database migrations and start the API and web app.
2. Use assisted provisioning to create a pilot company, a verified owner or
   accountant identity, and an authenticated browser session.
3. Open `/finance` and select that company.

## US-010 — Configure chart of accounts

1. When no chart exists, verify that Finance presents **Create UAE starter
   chart** rather than an empty journal form.
2. Create the starter chart. Verify that it lists the 11 initial accounts,
   including cash on hand (1000), VAT payable (2000), retail sales (4000), and
   cost of goods sold (5000).
3. Add account `6100 — Rent expense` as a posting expense account. Verify that
   it appears in the chart and in the journal account selector.
4. Try adding code `6100` again. The UI must retain the form and show the
   server's duplicate-account error.

## US-012 — Close a fiscal period

1. Create `FY 2027`, with start `2027-01-01` and end `2028-01-01`.
2. Verify that the period is **open** and that Finance explains the end date is
   exclusive. A journal dated `2027-12-31` is in the period; `2028-01-01` is
   not.
3. Attempt to create an overlapping period. Verify that the server rejects it
   and the existing period is unchanged.
4. Do not close the period yet; use it for the journal test below.

## US-011 — Post a balanced journal

1. In **Post manual journal**, select `FY 2027`, journal date `2027-07-01`, and
   description `Record owner capital introduced`.
2. Add these two lines:

   | Account              |  Debit | Credit |
   | -------------------- | -----: | -----: |
   | 1000 — Cash on hand  | 105.00 |        |
   | 3000 — Owner capital |        | 105.00 |

3. Verify that the totals show equal AED debits and credits and the form says
   **Balanced**. Post it.
4. Verify the status is **posted**, it appears in the recent journal list, and
   expanding the entry exposes both account lines and their debit/credit side.
5. Enter unequal values and verify **Post balanced journal** stays disabled.
   The API independently enforces the same rule; its integration tests cover
   attempts to bypass the UI.

## Complete the period-close check

1. Use **Close period** for `FY 2027` and accept the explicit confirmation.
2. Verify its status becomes **closed** and the action is no longer offered.
3. Try posting another journal into that period. The API must reject it because
   a closed period cannot receive entries.
4. Refresh the route. Verify the chart, closed period, and posted journal
   persist.

## Automated evidence

- Accounting database invariants, RLS, balance/immutability, retry, and period
  protection are tested in `packages/db/test/accounting-core.integration.test.ts`.
- Guarded chart, journal, and period API paths are tested in the API integration
  suite.
- The `/finance` route type-checks and builds in commit `96fe7d5`.

Record the pilot operator, date, result, and any exceptions in the linked
GitHub issue before changing US-010–US-012 to **Done** in the story tracker.
