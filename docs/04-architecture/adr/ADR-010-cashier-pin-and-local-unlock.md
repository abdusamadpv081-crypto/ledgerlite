# ADR-010: Cashier PIN and bounded local unlock

**Status:** Accepted  
**Date:** 2026-07-26  
**Decision owners:** Product owner / Ledger Lite team

## Context

A valid offline operational grant identifies an authorized cashier and browser
device, but it must not leave the POS immediately usable by anyone who gains
physical access to the till. A cashier PIN is a distinct, low-entropy local
credential. It cannot be treated as an OIDC password or stored like an API
token.

## Decision

Ledger Lite will use separate server and browser verifiers, each constrained
to its purpose.

1. A cashier PIN is numeric and distinct from the OIDC password. The initial
   policy range is 8–12 digits, with an 8-digit minimum, five failed offline
   attempts, 15-minute cool-off, and 12-hour maximum local session. The
   configurable policy allows up to 16 digits. These values live in versioned
   company/branch POS policy rather than hard-coded UI behavior.
2. The API receives a PIN only over the authenticated HTTPS session and never
   returns or logs it. It stores a unique random salt plus a 32-byte Argon2id
   result using Node's built-in `crypto.argon2`, with 64 MiB memory, three
   passes, one lane, and an environment-managed `POS_PIN_PEPPER`. This is a
   server verifier only; it is not sent to a browser.
3. On successful online PIN setup, the browser creates a device-and-cashier
   local verifier with a new 16-byte salt and PBKDF2-HMAC-SHA-256 at 600,000
   iterations, producing 32 bytes. The browser stores the verifier, salt,
   version, and failure-lock metadata only inside the encrypted
   `ledgerlite-pos` cache bound to company, branch, device, and cashier.
4. Offline unlock derives the same local PBKDF2 result and compares it in
   constant-time style. Five failed attempts create a durable local cool-off
   record. The successful unlock session is memory-only, must not outlive the
   operational grant or the configured session limit, and is cleared on lock,
   reload, or device reset.
5. The server records PIN set/reset operations and later receives offline
   unlock/failure evidence through the POS outbox. An online PIN reset
   invalidates the cached local verifier on that device at the next refresh;
   a remote reset cannot be known during a disconnected window, so the grant
   expiry remains the outer bound.

## Rationale

Argon2id is recommended for server-side password storage, and unique salts are
required; the Node runtime already exposes Argon2 with explicit memory, passes,
parallelism, and optional secret/pepper parameters. [OWASP password storage
guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
and [Node crypto Argon2](https://nodejs.org/api/crypto.html#cryptargon2algorithm-parameters-callback).

Browser Web Crypto does not provide Argon2. PBKDF2 is the widely available
password-oriented derivation primitive in `SubtleCrypto`; the 600,000
HMAC-SHA-256 work factor follows the OWASP fallback guidance. It is a bounded
offline verifier, not a replacement for the server's memory-hard hash.
[MDN SubtleCrypto PBKDF2](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)
and [OWASP PBKDF2 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

## Consequences

- The PIN is intentionally weaker than a primary password, so it can enable
  only the smallest POS capability set inside a valid grant and active shift.
- Browser encryption, a device-bound grant, rate limits, cool-off, server-side
  audit, short sessions, and shift controls combine; no individual control is
  sufficient against a compromised browser profile.
- PIN setup needs both an assigned POS role and a registered device. Owners and
  accountants do not obtain offline cashier authority through this feature.
- The runtime must use a Node version that supports `crypto.argon2`; the
  project development runtime currently does. Deployment images must enforce
  this as a startup prerequisite before the PIN endpoint is enabled.

## Implemented foundation

- `pos.cashier_pin` stores a self-only, forced-RLS Argon2id verifier and
  permits only a replacement with the next version. Its policy defaults live
  on `platform.policy_version`.
- `POST /api/v1/companies/:companyId/branches/:branchId/pos/pin` requires an
  authenticated cashier/branch-manager capability and registered device. The
  API uses a random salt, the environment-only pepper, HMAC-protected command
  idempotency, and correlated audit metadata without retaining PIN text.
- The `/pos` workspace uses Web Crypto PBKDF2 to produce an encrypted,
  device/cashier-bound local verifier. It persists failure/cool-off state and
  returns only an in-memory unlock expiry bounded by the cached authority.

## Deferred

- Manager override/reset workflow and separation-of-duties approval.
- Per-device server revocation receipt and outbox audit upload.
- Accessibility research for an on-screen PIN keypad and screen-reader
  friendly unlock UX.
