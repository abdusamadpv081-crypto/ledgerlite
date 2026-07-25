# Offline POS and synchronization specification — v0.1

## 1. Scope

The release-one POS must permit authorized cashiers to sell and refund from a device with no network connection. It is an **offline-capable browser application**, not a disconnected accounting system: final accounting and company-wide inventory authority remain in the cloud.

## 2. Data stored locally

The device retains only the data needed for the operational POS path:

- registered device identity and permitted branch;
- authenticated cashier session/authorization cache with a defined expiry policy;
- product catalogue, barcodes, prices, tax classes, and branch availability;
- allowed payment methods, discount/refund policy, and receipt settings;
- current shift, local sales/refunds/cash movements, and an immutable event outbox;
- last known synchronization watermark and server acknowledgements.

Local data must be encrypted where platform support permits and cleared/revoked when a device is deregistered. It is not a substitute for backup or the primary ledger.

## 3. Event contract

Every business event created on a POS device has:

- a globally unique immutable `event_id`, generated before the event is committed locally;
- company, branch, device, cashier, and shift identifiers;
- event type, device timestamp, local sequence number, and payload version;
- a deterministic idempotency key; and
- a lifecycle status.

The server stores an accepted event ID and returns its prior outcome for repeated deliveries. It must never create a second sale, journal, or stock movement for the same event.

## 4. Lifecycle states

| State | Meaning | Cashier-visible treatment |
| --- | --- | --- |
| Draft | Cart/change not yet committed. | Editable; not a sale. |
| Pending sync | Event is durably stored on the device but not cloud-acknowledged. | Receipt may be issued; clearly show offline/pending state where appropriate. |
| Syncing | Device is attempting delivery. | Do not permit duplicate manual resend. |
| Synced | Server accepted the event and completed authoritative effects. | Finalized. |
| Rejected | Server refused the event with a machine-readable reason. | Needs manager/support attention; never silently disappear. |
| Superseded | A documented correction/reversal supersedes the pending event. | Preserve both events and their linkage. |

## 5. Sync sequence

1. The device detects a usable connection and confirms the registered device/session.
2. It sends unsynced events in local sequence order, in bounded batches.
3. The server authenticates, authorizes, validates payload version and business rules, then checks `event_id`/idempotency key.
4. On a first accepted delivery, the server writes the event, inventory effects, accounting journal, and audit trail atomically.
5. The server returns an acknowledgement containing the event ID, authoritative transaction identifiers, and resulting state.
6. Only then does the device mark the event Synced and update its local cache.

## 6. Conflict and rejection policy

| Situation | Rule |
| --- | --- |
| Duplicate transmission | Return the original result; no duplicate accounting/inventory effects. |
| Product price changed after offline sale | Preserve the price presented and accepted on the device; audit the historical price version. |
| Product disabled after offline sale | Accept the previously permitted offline sale if its local policy/catalogue version was valid; flag only if policy requires review. |
| Cashier permission revoked while offline | Do not silently rewrite history. Server evaluates the configured offline-grace policy; reject/flag events beyond that policy. |
| Insufficient stock due to another branch/device sale | Do not alter a completed customer sale automatically. Accept sale with a stock exception or apply configured negative-stock policy; require manager resolution. |
| Shift already closed/server state mismatch | Reject as a resolvable exception; preserve local event and show actionable reason. |
| Malformed/obsolete payload | Reject with a compatible client-update or support path; retain event for evidence. |

## 7. UX and operational rules

- The POS header always shows **Online**, **Offline**, **Syncing**, or **Needs attention**; colour is supplementary to text/icon.
- The cashier can see the number of pending/rejected events and open their details.
- A pending event is never presented as cloud-posted or included as final cloud financial reporting until acknowledged.
- Retry is automatic with safe backoff; staff can request retry but cannot change the original event payload.
- Support/admin tools must surface event IDs, device, timestamps, reason codes, and linked correction events.

## 8. Open decisions

- POS policy configuration is defined in [ADR-001](../04-architecture/adr/ADR-001-configurable-pos-operating-policies.md). The release-one defaults are: block cashier sales at zero stock with a reasoned manager override; a 72-hour offline operating window; and offline refunds disabled unless manager-approved.
- Exact manager-PIN verification and cache/revocation mechanics.
- Whether product-level inventory policy overrides are in MVP or follow soon after.
- Receipt wording and whether a pending-sync marker is legally/operationally required for each payment method.
- Device/browser support matrix and printer/scanner integration approach.
