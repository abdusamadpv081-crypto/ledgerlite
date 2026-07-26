# ADR-009: Encrypt cached browser offline authority

**Status:** Accepted  
**Date:** 2026-07-26  
**Decision owners:** Product owner / Ledger Lite team

## Context

The offline operational grant is a bounded but sensitive bearer authority. A
registered browser must retain it across a network outage, and must safely
retry a lost challenge or issuance response without minting another grant.
Plaintext tokens, challenge nonces, or proof signatures in IndexedDB would be
unnecessarily exposed to local browser-storage inspection.

## Decision

The versioned `ledgerlite-pos` Dexie database will hold the browser device,
encrypted offline-authority cache, and encrypted pending grant attempt in one
schema.

1. A secure-context browser generates one non-extractable AES-GCM-256 cache
   key for its Ledger Lite POS profile. It is stored as a `CryptoKey` in the
   same IndexedDB database and is never exported, serialized, or sent to the
   API.
2. The grant token, verification JWK, and pending challenge/proof payload are
   encrypted with a fresh 96-bit IV. The AES-GCM additional authenticated data
   binds the ciphertext to the cache-record type plus company, branch, device,
   and cashier identifiers.
3. Only non-secret routing and expiry metadata is indexed in Dexie. A cached
   token is re-verified against its stored ES256 verification JWK before it is
   considered usable; malformed, altered, scope-mismatched, or expired records
   are rejected.
4. The refresh flow persists its two idempotency keys before network calls. It
   persists the returned challenge, then the device signature, before calling
   the issue endpoint. Retrying can therefore recover the original server
   response instead of creating a second grant.
5. Cache encryption reduces at-rest exposure. It is not an XSS or a malicious
   active-browser defense: JavaScript executing in the same browser profile can
   use a non-extractable key. HTTPS, CSP, trusted dependencies, and the later
   POS PIN/session controls remain mandatory.

## Consequences

- Browser storage reset loses the cache key and authority records, requiring
  online registration/refresh. This is an intended recovery boundary.
- A valid offline grant still does not unlock a cashier POS session; that is a
  separate PIN and cash-shift implementation.
- The cache must not contain OIDC sessions, raw PINs, passwords, or financial
  ledger state.
- Future device reset and support tooling must preserve unsynchronized business
  evidence while allowing non-financial authority-cache data to be cleared.

## Deferred

- PIN-derived local verifier and failure-lock records.
- Service-worker app-shell cache and offline catalogue/outbox encryption.
- Browser profile health telemetry and cache-key rotation on device recovery.
