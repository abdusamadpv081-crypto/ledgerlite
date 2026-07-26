# API and synchronization standards — v0.1

## API style

- REST over HTTPS, JSON request/response bodies, and OpenAPI as the published contract.
- Version external API routes from the beginning: `/api/v1/...`.
- Use resource reads for queries and explicit command endpoints for financial/operational actions.
- Use ISO 8601 timestamps with offsets/UTC; include company/branch context in all scoped responses.
- Use opaque UUID/ULID identifiers; never rely on sequential database IDs as external identifiers.

## Command requirements

Every state-changing endpoint requires:

- authenticated actor and tenant/branch authorization;
- authenticated registered device context for POS operational commands after
  device enrollment;
- request schema validation;
- an idempotency key for retryable client/POS commands;
- server-generated correlation/trace ID;
- audit recording where the action is sensitive; and
- an explicit response state, not an ambiguous success message.

Financial commands are processed inside a PostgreSQL transaction. A response is successful only after all required event, inventory, journal, and audit writes commit.

## Company and branch administration

The first production back-office routes are protected by the browser-session and
route-scoped capability guards. Tenant and branch identifiers come exclusively
from route parameters; they are never accepted from request bodies.

| Route                                                   | Capability       | Purpose                                                                  |
| ------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `GET /api/v1/companies/:companyId`                      | `company.read`   | Read the company profile.                                                |
| `PATCH /api/v1/companies/:companyId`                    | `company.manage` | Change legal/configuration fields with optimistic concurrency.           |
| `GET /api/v1/companies/:companyId/branches`             | `company.read`   | List the tenant's branches.                                              |
| `POST /api/v1/companies/:companyId/branches`            | `branch.manage`  | Create a branch; only a company-wide owner can pass this unscoped route. |
| `GET /api/v1/companies/:companyId/branches/:branchId`   | `branch.read`    | Read one permitted branch.                                               |
| `PATCH /api/v1/companies/:companyId/branches/:branchId` | `branch.manage`  | Change a permitted branch.                                               |

All `POST`/`PATCH` routes require an `Idempotency-Key` header (8–200 URL-safe
characters). A key is scoped to company, actor, and command. Retrying the same
payload returns the original response and correlation ID; reusing a key with a
different payload returns `409 Conflict`. Updates also require the exact
`expectedUpdatedAt` value from the immediately preceding read, preserving
optimistic-concurrency protection at PostgreSQL microsecond precision.

Each accepted change writes immutable audit evidence (`company.updated`,
`branch.created`, or `branch.updated`) inside the same transaction. A branch
cannot be closed by this general update route; closing will be a later
controlled lifecycle command after device, shift, and stock safeguards exist.

## Catalogue management

The initial catalogue workspace is company-scoped and is intended for the
pilot owner who maintains the shared product master. Branch availability is a
separate branch-scoped command, so an assigned branch manager can be
authorized only for that branch's sellability and reorder controls.

| Route                                                                                           | Capability       | Purpose                                                                                                |
| ----------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/companies/:companyId/catalog`                                                      | `catalog.manage` | Read active, POS-ready products, tax codes, current prices, and active barcodes.                       |
| `POST /api/v1/companies/:companyId/catalog/tax-codes`                                           | `catalog.manage` | Create an active tax code.                                                                             |
| `POST /api/v1/companies/:companyId/catalog/products`                                            | `catalog.manage` | Create a product and its first effective price in the named price list.                                |
| `PATCH /api/v1/companies/:companyId/catalog/products/:productId`                                | `catalog.manage` | Change master data, replace the current price, or deactivate/reactivate a product without deleting it. |
| `POST /api/v1/companies/:companyId/catalog/products/:productId/barcodes`                        | `catalog.manage` | Assign a unique company-wide barcode to a product.                                                     |
| `POST /api/v1/companies/:companyId/catalog/branches/:branchId/products/:productId/availability` | `catalog.manage` | Set sellability and optional reorder point for the permitted branch.                                   |

All catalogue commands require an `Idempotency-Key`, write immutable audit
evidence with the command correlation ID, and execute under tenant RLS. Product
updates require `expectedUpdatedAt` from the immediately preceding read. A
price replacement closes the preceding current price row and inserts a new
effective-dated row; it never overwrites a price that may be needed by a
historical sale or journal.

## Device and accounting commands

| Route                                                                                | Capability                                             | Purpose                                                                                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `GET /api/v1/auth/branches`                                                          | authenticated session                                  | List only the actor's explicitly assigned active branch contexts.                          |
| `GET/POST /api/v1/companies/:companyId/branches/:branchId/devices`                   | `pos.device.manage`                                    | List or register branch-scoped device public keys; the server derives the key fingerprint. |
| `PATCH /api/v1/companies/:companyId/branches/:branchId/devices/:deviceId`            | `pos.device.manage`                                    | Suspend, retire, or reinstate a device with optimistic concurrency.                        |
| `GET /api/v1/pos/offline-grants/verification-key`                                    | authenticated session                                  | Download the current ES256 verification JWK while online for offline grant verification.   |
| `POST /api/v1/companies/:companyId/branches/:branchId/pos/offline-grants/challenges` | `pos.shift.operate`                                    | Create a five-minute, one-use device-proof challenge.                                      |
| `POST /api/v1/companies/:companyId/branches/:branchId/pos/offline-grants`            | `pos.shift.operate`                                    | Verify the registered device signature and issue a policy-bounded operational grant.       |
| `POST /api/v1/companies/:companyId/branches/:branchId/pos/pin`                       | `pos.shift.operate`                                    | Set/reset the caller's server Argon2id PIN verifier for a registered device.               |
| `GET /api/v1/companies/:companyId/accounting/chart`                                  | `accounting.journal.read`                              | Read the active chart and accounts.                                                        |
| `POST /api/v1/companies/:companyId/accounting/chart/starter`                         | `accounting.chart.manage`                              | Create the UAE retail starter chart once.                                                  |
| `POST /api/v1/companies/:companyId/accounting/chart/accounts`                        | `accounting.chart.manage`                              | Add a tailored posting or parent account.                                                  |
| `GET/POST /api/v1/companies/:companyId/accounting/journals`                          | `accounting.journal.read/post`                         | Read posted journals or atomically post a balanced manual journal.                         |
| `GET/POST /api/v1/companies/:companyId/accounting/periods`                           | `accounting.journal.read` / `accounting.period.manage` | Read or create fiscal periods.                                                             |
| `POST /api/v1/companies/:companyId/accounting/periods/:id/close`                     | `accounting.period.manage`                             | Close an unchanged period only when it has no draft journals.                              |

Journal posting and period closure are guarded again inside PostgreSQL. Only
the security-definer posting function may transition a draft journal to
immutable `posted`, and only the close function may change a fiscal-period
lifecycle. Both require tenant context, emit command-correlated audit evidence,
and preserve retries through the standard idempotency mechanism.

An offline-grant challenge is bound to the cashier, branch, and registered
device, expires after five minutes, and may be consumed exactly once. Its
response, signature, and resulting grant issuance use separate idempotency
keys. Grant issuance requires `POS_OFFLINE_GRANT_SIGNING_PRIVATE_JWK` and
`POS_OFFLINE_GRANT_SIGNING_KEY_ID` in deployment secret storage. The server
stores a SHA-256 token digest and grant metadata, never the browser's private
key, browser session, OIDC token, or raw POS PIN.

The cashier-PIN command accepts a numeric value within the current policy range
(8–12 digits by default, with an allowed maximum of 16) over the authenticated
HTTPS session. It requires a registered device and `pos.shift.operate`, hashes
the value with a per-user salt plus environment-managed pepper, writes no raw
PIN or fast PIN digest to idempotency/audit storage, and returns only the
versioned local-unlock policy. The browser derives and encrypts its separate
local verifier after the command succeeds.

## POS sync endpoint contract

**Proposed endpoint:** `POST /api/v1/pos/sync/events`

One request carries a bounded ordered batch of immutable local events. Each event includes:

```text
eventId, eventType, schemaVersion, occurredAt, localSequence,
companyId, branchId, deviceId, cashierId, shiftId,
policyVersion, idempotencyKey, payload
```

Each returned result includes:

```text
eventId, resultStatus, serverTransactionId?, journalEntryId?,
receiptId?, rejectionCode?, rejectionMessage?, acknowledgedAt
```

`resultStatus` is one of `accepted`, `duplicate_accepted`, `rejected`, or `requires_review`. Retries of an accepted event must return the original acknowledgement rather than create new financial effects.

## Error conventions

Use RFC 9457 problem-details style responses, with a stable application code such as `POS_SHIFT_CLOSED`, `POLICY_EXPIRED`, `INSUFFICIENT_STOCK`, or `EVENT_SCHEMA_UNSUPPORTED`. Do not reveal another tenant’s data or internal stack details.

## Offline boundaries

- The POS may create only previously authorized local actions under its cached policy.
- The POS never marks an event cloud-posted until acknowledgement.
- The server is free to reject an event with a resolvable reason; the device preserves it for review.
- Payment state and sync state are independent. A locally recorded payment is not necessarily provider-settled.

## Contract verification

- Generate the TypeScript API client from OpenAPI.
- Add API schema compatibility checks to CI.
- Test sync idempotency, duplicate delivery, malformed payload, authorization change, policy expiry, and partial-batch failure scenarios.
