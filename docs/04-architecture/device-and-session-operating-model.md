# Device and session operating model — v0.1

## State model

```text
Registered device
  → online user session established
  → policy/catalogue/grant synchronized
  → cashier PIN unlocks bounded offline session
  → local POS events are recorded and synchronized
  → session ends / grant expires / device is revoked
```

## Key states

| State                  | POS behavior                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| Ready online           | Registered device, valid online session, current policy/cache. All authorized online POS actions available. |
| Ready offline          | Valid offline grant and PIN-unlocked cashier session. Only listed offline capabilities available.           |
| Offline nearing expiry | Shows warning; staff continue limited work but must reconnect before grant expiry.                          |
| Offline expired        | Shows blocking state for new sales; preserves and surfaces outbox until reconnection.                       |
| Needs attention        | Unsynced/rejected event, policy mismatch, or device health issue; cashier sees clear next action.           |
| Suspended/revoked      | Once device receives server state, stop use and follow safe outbox/support procedure.                       |

## Session and handover rules

- A cashier shift belongs to one authenticated cashier and device at a time.
- Cashier lock/logout ends the local UI session; it does not erase a durable outbox or closed-shift evidence.
- A manager must authenticate separately for an offline approval. The cashier cannot re-use their own PIN as manager proof.
- Browser tabs on the same registered POS must coordinate to avoid two concurrent carts/shifts; MVP should restrict active POS use to one tab and show a clear warning/lock in other tabs.
- Device/browser clock drift is recorded and checked on reconnect. The server timestamp remains authoritative for posting/reporting.

## Initial support baseline

The browser support matrix is validated before pilot, but the engineering target is:

- Desktop POS: current Google Chrome and Microsoft Edge on supported Windows devices.
- Tablet POS: current Chrome on supported Android devices.
- Back office: current Chrome, Edge, Safari, and Firefox.

Safari/iOS POS and a native/mobile hardware bridge are deferred until the initial printer/scanner/payment-terminal integration study. Barcode scanners acting as keyboard input work without a special browser integration; printers/cash drawers require tested device-specific support.

## Test scenarios

1. Device registration and re-registration after browser storage reset.
2. Owner login/session rotation/logout; confirm tokens never appear in browser storage.
3. Cashier offline unlock succeeds only with valid device/grant/PIN.
4. Five invalid PIN attempts lock offline unlock and create an auditable event on reconnect.
5. Grant expiry blocks new sales but preserves existing local evidence.
6. Manager offline approval creates a linked approval event and cannot self-approve under configured policy.
7. Device revocation prevents new online work and rejects sync from the revoked device.
8. Two-tab attempt prevents conflicting shift/cart state.
