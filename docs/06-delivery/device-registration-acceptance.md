# Browser POS device registration acceptance

**Scope:** browser device trust path supporting US-030  
**Route:** `/devices`  
**Required role:** company owner, or a branch manager assigned to the selected
branch.

This is a pilot acceptance script for browser-bound device registration. It
does not yet issue an offline grant, cache catalogue data, unlock a cashier, or
start a shift.

## Preconditions

1. Apply the current database migrations and start the API and web app.
2. Sign in over HTTPS. `localhost` is acceptable for local development because
   browsers treat it as a secure context.
3. Provision either an owner for the pilot company or a branch-manager role
   scoped to the branch being tested.

## Registration and retry safety

1. Open `/devices`. Verify that an owner can select every active company branch
   and a branch manager can select only explicitly assigned active branches.
2. Enter `Main counter till` and choose **Register this browser**.
3. Verify that the browser shows **Trusted**, the server list contains the
   device with status **registered**, and the fingerprint shown locally matches
   the server row.
4. Refresh the page. Verify that this browser remains trusted. The private key
   stays non-exportable in the browser's `ledgerlite-pos` IndexedDB database;
   only its public JWK/fingerprint is sent to the server.
5. To exercise retry handling, temporarily interrupt the request during a
   registration attempt, restore the connection, and choose **Retry device
   registration**. The pending key and idempotency key must be reused; the
   server must show one device, not duplicates.

## Lifecycle and recovery

1. Suspend the registered device. Verify the table and the local browser card
   both display **suspended**, with the explanation that it cannot receive a
   future operational grant.
2. Reinstate it and verify it returns to **registered**.
3. Retire it and verify it cannot be reinstated by this workspace.
4. Clear the browser's site data only after recording any future unsynced POS
   events. On the next visit, the local signing material is absent and the
   browser must be registered again. This is intentional recovery behavior.

## Automated evidence

- Device JWK validation, fingerprint uniqueness, tenant/branch scope,
  idempotency, lifecycle updates, and correlated audit events are covered by
  API integration tests.
- Assigned branch discovery uses a dedicated least-privilege definer role and
  is covered by `active-branch-contexts.integration.test.ts`.
- The `/devices` route type-checks and production-builds in commits `d618a9c`
  and `395b188`.

Record the pilot operator, browser family/version, date, result, and any
exceptions in the linked GitHub issue. Browser/device compatibility findings
will set the supported POS browser matrix before release.
