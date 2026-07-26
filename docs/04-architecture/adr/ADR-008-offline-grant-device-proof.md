# ADR-008: Offline grant signing and device proof of possession

**Status:** Accepted  
**Date:** 2026-07-26  
**Decision owners:** Product owner / Ledger Lite team

## Context

A registered device public key alone does not prove that an online cashier is
using the browser profile that holds its private key. Offline authority must be
bounded, independently verifiable while disconnected, and recoverable when an
HTTP response is lost without minting a second grant.

## Decision

Ledger Lite issues a compact JWS offline operational grant with `ES256` and
requires an online challenge-response signed by the registered browser device
key before it issues a grant.

1. The server signing private JWK is supplied only through
   `POS_OFFLINE_GRANT_SIGNING_PRIVATE_JWK`; it is never committed, returned by
   an API, or placed in browser storage. `POS_OFFLINE_GRANT_SIGNING_KEY_ID`
   identifies the key for rotation.
2. The verification public JWK is derived from the private JWK and downloaded
   while online over the authenticated HTTPS application origin. The POS caches
   it with its grant. The key identifier supports overlapping verification keys
   during a future rotation.
3. A cashier or branch manager with `pos.shift.operate` requests a five-minute,
   single-use challenge for a registered device in their permitted branch. The
   browser signs the exact challenge envelope with its non-exportable P-256
   device key. The server verifies the signature before issuing authority.
4. The signed grant contains only grant, company, branch, device, cashier,
   policy, capability, issue, expiry, schema, issuer, and key-ID data. It has
   no browser session, OIDC token, password, or POS PIN.
5. The server stores the SHA-256 token digest and immutable grant metadata. A
   grant can later be revoked through a controlled lifecycle transition; sync
   validates the stored grant, device, policy, and expiry even when the client
   signature was valid locally.
6. The effective `platform.policy_version.offline_max_hours` determines expiry.
   The existing constrained range of 4–168 hours is the configuration boundary;
   72 hours remains the UAE pilot default.
7. This first grant scope permits only `pos.shift.operate` and
   `pos.sale.create`. Offline refunds, discounts, PIN unlock, shift lifecycle,
   and sale synchronization each require their own guarded implementation.

## Consequences

- A compromised browser session cannot mint a usable grant for a device without
  its private signing key.
- A stolen browser profile may retain a limited grant until expiry; short policy
  windows, PIN unlock, server-side revocation on reconnect, and minimal cached
  data remain necessary safeguards.
- The private signing JWK is a production secret and must be managed by the
  deployment secret store. Local development and integration tests generate
  ephemeral keys instead.
- The grant is proof of bounded offline authority, not proof of a settled sale
  or permission to access back-office routes.

## Deferred

- Key-rotation endpoint and retirement schedule.
- PIN verifier derivation, failure limits, and manager approval records.
- Grant refresh UX, emergency extension tokens, and browser support telemetry.
