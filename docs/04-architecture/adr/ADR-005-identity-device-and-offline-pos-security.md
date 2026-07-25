# ADR-005: Identity, device, and offline POS security

**Status:** Accepted  
**Date:** 2026-07-25  
**Decision owners:** Product owner / Ledger Lite team

## Context

Ledger Lite is a multi-tenant financial SaaS, but its POS must make limited sales activity possible during outages. Standard online authentication, browser sessions, and offline cashier authorization have different risk profiles and must not be treated as the same credential.

## Decision summary

1. Online user authentication uses an **OIDC Authorization Code + PKCE** integration with a dedicated identity provider. The application does not implement its own general-purpose password service.
2. Browser session credentials use a same-origin, server-managed `HttpOnly`, `Secure`, `SameSite=Strict`, `__Host-` prefixed cookie; no JWT, refresh token, or primary credential is stored in localStorage, sessionStorage, or Dexie.
3. Every POS browser installation is a **registered device** bound to one company and branch, with a device key pair and revocable server record.
4. Offline POS access uses a separate, time-limited **offline operational grant** plus a dedicated cashier/manager POS PIN. It is not an OIDC session and cannot access online back-office functions.
5. Owner and accountant roles have no offline back-office access. Offline capability is limited to permitted branch cashiers/managers and cached policy.

The exact production OIDC provider remains a vendor-selection decision before pilot launch. Local development uses an OIDC-compatible test provider; application code depends only on standards and an identity-provider adapter.

## Online authentication and sessions

### User authentication

- Owners, accountants, managers, and cashiers authenticate online through the chosen OIDC provider.
- Require MFA for owners and users with financial-configuration/period-close capabilities. Offer WebAuthn/passkeys as the preferred strong MFA option where supported.
- Sessions are rotated after authentication, privilege escalation, password/MFA recovery, and other re-authentication events.
- Do not force arbitrary periodic password changes; enforce strong passwords/MFA through the identity provider instead.

### Browser session rules

- Session cookie: `__Host-ll_session`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain` attribute.
- Browser/API deployment uses a same-origin API path (for example, `app.ledgerlite.com/api/...`) behind a reverse proxy, so POS sync can use secure cookies without exposing bearer tokens to JavaScript.
- Default online session: 15-minute inactivity timeout and 8-hour absolute timeout; high-risk actions may require re-authentication.
- Online logout invalidates server session and clears browser credentials/cache safely. It must warn and prevent logout if unsynced POS events exist unless a manager follows a documented handover/recovery path.

These rules follow OWASP’s guidance to use secure HttpOnly cookies and to avoid browser Web Storage for authentication tokens. [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

### Implemented server boundary

- `platform.browser_session` keeps only a SHA-256 digest of a 32-byte opaque browser token, supports idle/absolute expiry, and makes invalidated sessions permanently immutable.
- OIDC Authorization Code + PKCE uses `platform.oidc_login_transaction`: state is stored only as a digest, while the nonce and verifier are encrypted with a 32-byte environment-managed key and may be consumed once within ten minutes.
- The API exposes `/api/v1/auth/login`, `/api/v1/auth/callback`, and `/api/v1/auth/logout`. Callback cookies are named `__Host-ll_session` and set with `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`, with no `Domain` attribute.
- Successful OIDC authentication only creates a session for an existing active `platform.app_user`; it never self-provisions an arbitrary identity. The future access-management/onboarding workflow is responsible for provisioning staff.
- The API accepts no partial OIDC configuration. All `OIDC_*` values must be set together; an HTTP issuer is accepted only when `NODE_ENV=development`, while browser authentication still needs HTTPS for the `__Host-` cookie.

## POS device registration

### Registration

An owner or authorized manager registers a device while online:

1. Device generates a non-exportable Web Crypto signing key pair in a secure browser context.
2. The browser sends the public key and device metadata for registration.
3. Server creates a device record scoped to company and branch, assigns allowed POS capabilities/cache profile, and records audit history.
4. Device downloads its initial allowed data/policies and receives a short-lived device authorization context.

Device state includes: device ID, company/branch, public key, status (`active`, `suspended`, `revoked`), last sync, app/schema version, policy version, and cache expiry.

### Revocation and recovery

- A revoked/suspended device cannot obtain a new grant or upload new actions after receiving the status; the server rejects all later events.
- A device that has been offline cannot learn a remote revocation until it reconnects. Its limited offline grant remains bounded by expiry and policy.
- Clearing browser storage, changing browser profile, or losing the device key requires fresh online registration. This is intentional.
- Device deregistration requires handling unsynced events first; no silent deletion of evidence.

## Offline operational grant and PIN

### Grant contents and lifecycle

After an online device/user sync, the POS caches a signed, time-limited offline operational grant. It contains only: grant ID, device/company/branch/user IDs, allowed offline capabilities, effective policy/role version, issue/expiry time, and server signature/reference. It contains no primary password, OIDC access token, or refresh token.

- Default grant/maximum offline device window: 72 hours, under ADR-001 policy control.
- A cashier’s offline session lasts at most 12 hours and cannot outlive the grant or active-shift policy.
- Device must show expiry/offline state visibly and prevent new sales after expiry.
- Server validates grant identifiers/policy/version on synchronization, while preserving rejected events as evidence.

### POS PIN

- A POS PIN is **separate from the user’s OIDC password** and is used only on a registered device for offline POS unlock/approval.
- Minimum length: 8 numeric digits for MVP; allow a longer alphanumeric PIN in future. Do not use a four-digit PIN.
- The server stores a strong password hash for online management. The device stores only a derived local verifier/parameters needed for bounded offline verification, never raw PIN text.
- Local verification uses Web Crypto in HTTPS contexts, rate limits failures, and locks the local PIN path after five failed attempts until a configured cool-off or online manager recovery.
- The device records successful unlock/approval events locally and syncs them for audit.

Web Crypto is available in secure contexts and supports password-based key derivation primitives such as PBKDF2, but its low-level nature requires careful reviewed implementation. [MDN SubtleCrypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)

## Offline capabilities

| Role             | Permitted offline capability                                                                                                    | Not permitted offline                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Cashier          | Start/continue own permitted shift, cash/manual sale, permitted manual discount, view locally available receipt, close request. | Company setup, product/customer changes, reports, journal access, policy changes, unrestricted refund. |
| Manager          | Cashier actions; approve configured refund/discount/negative-stock exception using own PIN; review local sync queue.            | Tenant/security/policy changes, period close, chart/tax changes.                                       |
| Accountant/owner | No offline back-office mode.                                                                                                    | All accounting/admin actions while offline.                                                            |

An offline manager approval is a separate immutable local record that names approver, action, target event, reason, timestamp, and policy version. Separation-of-duties policy can prohibit self-approval.

## Security safeguards

- HTTPS only; strict Content Security Policy, dependency scanning, and XSS prevention are release requirements.
- Every command is authorized server-side by current capability/scope, even if client UI hides controls.
- Rate-limit online login, PIN verification, device registration, and sync endpoints.
- Never log PINs, passwords, session values, OAuth tokens, or unredacted payment data.
- Treat browser storage as a risk-bearing cache, not encrypted hardware storage; keep cached POS data minimal and clear it safely on device reset/logout according to outbox recovery policy.
- Use audit events for registration, PIN reset, device status change, offline unlock, approvals, policy changes, and authorization failures that merit review.

## Deferred decisions

- Production OIDC provider selection, commercial terms, and regional/data-residency assessment.
- Exact identity-provider MFA/recovery configuration.
- Browser support matrix and peripheral bridge/printing strategy.
- Final PBKDF2 parameters after device performance testing and independent security review.
