# Browser offline-authority acceptance

**Scope:** device-proof authority cache supporting US-030  
**Route:** `/pos`  
**Required role:** branch manager or cashier explicitly assigned to the branch

This script validates the online preparation step for offline POS. It does
**not** yet unlock a cashier, open a shift, or permit a sale.

## Preconditions

1. Apply current migrations and start the API and web application. Use HTTPS
   or `localhost` in a current Chrome or Edge browser.
2. Register this exact browser profile as a POS device for the branch using
   [`device-registration-acceptance.md`](device-registration-acceptance.md).
3. Provision a `branch_manager` or `cashier` role scoped to the same branch.
   An owner-only role is intentionally not allowed to obtain offline operating
   authority; use the assisted pilot process to grant staff access.
4. Supply a private P-256 JWK and key ID to the API environment. Use an
   approved deployment secret store for any shared or production environment.
   The following creates an ephemeral development-only key in the current
   PowerShell session before starting the API:

   ```powershell
   $env:POS_OFFLINE_GRANT_SIGNING_PRIVATE_JWK = node -e "const { webcrypto } = require('node:crypto'); (async () => { const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']); console.log(JSON.stringify(await webcrypto.subtle.exportKey('jwk', keys.privateKey))); })();"
   $env:POS_OFFLINE_GRANT_SIGNING_KEY_ID = 'local-offline-grant-20260726'
   ```

   Never commit the generated value or reuse a development key for a pilot.

## Authority refresh and cache verification

1. Sign in as the assigned manager or cashier and open `/pos`.
2. Verify the selected company and branch are the explicitly assigned POS
   context, and **This browser** shows **Registered**. If it does not, return
   to `/devices` with an authorized owner/manager to register the browser.
3. Choose **Refresh offline authority** while online.
4. Verify the screen displays **Ready**, an expiry in Dubai time, a grant ID,
   and a policy version. The screen must state that cashier unlock and a cash
   shift are still required before sales.
5. Reload `/pos` while still online. Verify the same valid authority is read
   from local storage and its expiry is displayed. The token must be verified
   again before the UI treats it as ready.
6. In browser developer tools, inspect the `ledgerlite-pos` IndexedDB
   database. `offlineAuthorities` and `offlineAuthorityAttempts` may expose
   routing/expiry metadata but must not expose a plaintext JWS token, nonce,
   or device signature. Those payloads are AES-GCM ciphertext.

## Retry and lifecycle expectations

1. Begin a refresh, interrupt the network before the response is received,
   restore connectivity, and choose **Refresh offline authority** again.
   The retry must reuse the encrypted challenge/proof and idempotency keys; it
   must recover one server grant rather than create a second one.
2. Suspend the device from `/devices`, then return to `/pos` and refresh. The
   server must deny a new authority grant. Reinstating the device permits a new
   online refresh.
3. After the cached grant expiry, refresh `/pos`. The cached authority must be
   removed and shown as unavailable; existing non-financial evidence is not
   affected.
4. Do not clear browser site data while future unsynced POS events exist.
   Clearing it removes the non-extractable device/cache keys and requires a new
   online registration and authority refresh.

## Automated evidence

- API integration tests generate independent P-256 keys, validate device proof,
  JWS signing, idempotency, token-digest persistence, forced RLS, and audit
  evidence.
- Web tests independently verify a valid ES256 authority and reject a tampered
  token or a token bound to another cashier.
- The web production build includes the `/pos` route. The repository quality
  gate runs the web tests in addition to domain, API, and database tests.

Record the pilot operator, staff role, branch, browser family/version, expiry
window, date, result, and exceptions in the linked GitHub issue. Do not record
the authority token, private signing JWK, PIN, browser session, or other
credential in the issue.
