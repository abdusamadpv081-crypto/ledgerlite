# Manual tester guide

**Audience:** a functional tester using a local Ledger Lite environment
**Last verified:** 2026-07-28
**Application:** web `http://localhost:3000` and API health
`http://localhost:3001/api/v1/health`

## 1. What is ready to test

| Area                       | Ready now                                                                                                     | Do not test as complete yet                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Authentication and tenancy | OIDC session boundary, provisioned-user access, company and branch isolation                                  | Public signup, invitation workflow, password login                  |
| Catalogue                  | Tax codes, products, prices, barcodes, branch availability                                                    | Receiving stock, stock adjustments, inventory valuation             |
| Accounting                 | Starter chart, accounts, fiscal periods, balanced manual journals, and posted cash-sale journals after sync   | Financial statements, VAT return, COGS/inventory-value POS journals |
| POS cash sale              | Offline checkout, signed encrypted outbox, intentional sync, and cash/revenue/VAT plus stock-quantity posting | UAE receipt, card payment, refund, COGS, shift close, cash variance |

The `/pos` page can now capture a cash sale locally and synchronize it once
connectivity returns. A row is authoritative only when it displays `Synced`;
`Pending sync` and `Rejected` are not completed sales.

## 2. Local environment and access gate

The local PostgreSQL and Redis containers must be running and migrations must
be current:

```powershell
docker compose -f infra/compose/docker-compose.yml up -d
corepack pnpm --filter @ledgerlite/db migrate
```

The current local test server is available at the URLs above. If it has been
stopped, rebuild and run the API, then build and start the web application:

```powershell
$env:DATABASE_URL = 'postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite'
$env:NODE_ENV = 'development'
$env:WEB_APP_ORIGIN = 'http://localhost:3000'
corepack pnpm --filter @ledgerlite/api build
node apps/api/dist/main.js
```

In another terminal:

```powershell
corepack pnpm --filter @ledgerlite/web build
corepack pnpm --filter @ledgerlite/web start
```

### Sign-in is intentionally gated

There is no development sign-in bypass, public registration, or test password.
To perform authenticated tests, an operator must configure a non-production
OIDC client and provision the test identities before they sign in. Required API
environment variables are `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, and
`OIDC_TRANSACTION_ENCRYPTION_KEY`. Use the assisted workflow in
[assisted-pilot-provisioning.md](assisted-pilot-provisioning.md), never direct
database edits or production credentials.

Prepare at least these test identities:

| Account             | Minimum role                                   | Purpose                                       |
| ------------------- | ---------------------------------------------- | --------------------------------------------- |
| Owner               | `owner` for the company                        | Catalogue, finance, company and device checks |
| Cashier             | `cashier` scoped to the selected branch        | PIN, POS shift, local cash sale, and sync     |
| Optional manager    | `branch_manager` scoped to the selected branch | Device/POS operational checks                 |
| Optional accountant | `accountant` for the company                   | Finance access and separation checks          |

For signed offline authority and PIN setup, set non-production API secrets
before starting the API, as shown in
[offline-authority-acceptance.md](offline-authority-acceptance.md). Do not put
these values in Git, screenshots, tickets, or test evidence.

## 3. Test scenarios

Record the test ID, account, branch, browser, actual result, and screenshot or
network error for every failure.

### LL-T00 - availability and security boundary

1. Open `http://localhost:3001/api/v1/health`.
2. Expected: JSON states `status: "ok"` and `service: "ledgerlite-api"`.
3. Open `http://localhost:3000`.
4. Expected before login: the UI says sign-in is required; it must not reveal a
   company, catalogue, account, product, or POS data.
5. With no OIDC configuration, attempt `/api/v1/auth/login`.
6. Expected: the service refuses sign-in configuration rather than accepting a
   local password or creating an account.

### LL-T10 - company, branch, and authorization scope

1. Sign in as the provisioned owner. Confirm only the assigned company is
   shown.
2. Open the catalogue and finance workspaces. Confirm they load for the owner.
3. Sign in as the cashier. Open `/pos`; confirm only explicitly assigned
   branches are selectable.
4. Try the owner-only catalogue/finance actions as the cashier.
5. Expected: the API rejects the action and the UI must not present it as a
   successful save.
6. If a second test company exists, repeat steps 1-3 with its owner. No data
   from the first company may appear.

### LL-T20 - catalogue management

1. Sign in as the owner and open `/`.
2. Create a tax code, for example `TEST5`, `Test VAT 5%`, rate `5`.
3. Create a stock product with a distinctive SKU, name, price, and the new tax
   code. Mark it sellable at the active branch.
4. Add a unique barcode, then reload the page.
5. Expected: the product, price, tax treatment, barcode, and branch
   availability persist after reload.
6. Negative checks: try a duplicate active barcode, duplicate effective tax
   code, blank required name, or invalid price. Each must fail without creating
   a partial product or tax record.

### LL-T30 - accounting workspace

1. Sign in as an owner or accountant and open `/finance`.
2. Create the UAE retail starter chart once.
3. Expected: accounts load with codes, names, account types, normal balances,
   and posting status.
4. Attempt to create the starter chart again.
5. Expected: the second request is safely rejected; duplicate accounts are not
   created.
6. Create an open fiscal period with valid start/end dates.
7. Post a two-line manual journal with equal debit and credit values.
8. Expected: it becomes `posted`, shows the posted timestamp, and cannot be
   edited from the workspace.
9. Negative check: submit an unbalanced journal. Expected: rejection with no
   partial journal or journal lines.

### LL-T40 - registered POS browser device

1. Sign in as the owner or authorized branch manager and open `/devices`.
2. Register the current browser with a recognisable test name such as
   `QA Chrome Windows`.
3. Reload the page.
4. Expected: the device remains registered and displays its fingerprint/status.
   Do not expect or request access to a browser private signing key.
5. Suspend or retire only a disposable test device. Expected: it cannot be
   used for new POS authority/shift actions. Restore the device if the test
   scenario requires it.

### LL-T50 - POS authority, cashier PIN, and start shift

1. Use the branch-scoped cashier account in the exact registered browser and
   open `/pos`.
2. Complete the detailed scripts in this order:
   - [offline-authority-acceptance.md](offline-authority-acceptance.md)
   - [cash-shift-opening-acceptance.md](cash-shift-opening-acceptance.md)
3. Key expected outcomes:
   - authority is tied to the cashier, branch, and browser device and has an
     expiry;
   - no raw PIN or authority token is visible in IndexedDB;
   - wrong PIN attempts reduce the remaining count and trigger the configured
     local cool-off;
   - an online opening float creates one active cash shift, survives an online
     reload, and displays no sale/journal result;
   - opening a second active shift for the same cashier or device is rejected.
4. While the `/pos` page remains open, disable network in browser developer
   tools. Expected: the encrypted cached authority, PIN verifier, opened shift,
   catalogue, and local outbox remain available. Follow
   [US-031 local-sale test](../07-testing/us-031-local-sale-outbox.md) and
   [US-032 sale-sync test](../07-testing/us-032-sale-sync.md) for the complete
   cash-sale scenario.

## 4. Expected limitations, not defects

- Cash sales sync only when the cashier explicitly selects **Sync sales**; a
  pending or rejected event is not an authoritative sale.
- There is no UAE receipt/invoice, card/external-terminal payment, refund, or
  COGS/inventory-value POS posting yet.
- No new shift can be opened while disconnected.
- Shift close, cash counts, variance, and accounting postings are later work.
- Arabic content/RTL user testing is not a release-ready feature yet.
- The local PIN unlock is memory-bound after verification; a page reload
  deliberately requires PIN entry again.

## 5. Defect report template

```text
Test ID:
Environment/browser:
Tester account role and branch (no passwords, tokens, or PINs):
Steps performed:
Expected result:
Actual result:
Timestamp (Asia/Dubai):
Screenshot/video or redacted network response:
Severity: blocker / high / medium / low
```

Never attach OIDC tokens, cookies, private device keys, offline-grant tokens,
cashier PINs, secret environment values, or unredacted customer data.
