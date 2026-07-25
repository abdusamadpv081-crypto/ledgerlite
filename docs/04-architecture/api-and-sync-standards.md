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
- authenticated registered device context for POS device commands;
- request schema validation;
- an idempotency key for retryable client/POS commands;
- server-generated correlation/trace ID;
- audit recording where the action is sensitive; and
- an explicit response state, not an ambiguous success message.

Financial commands are processed inside a PostgreSQL transaction. A response is successful only after all required event, inventory, journal, and audit writes commit.

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
