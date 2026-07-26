import { offlineGrantChallengePayload } from "@ledgerlite/domain";
import { request } from "./api";
import {
  type EncryptedOfflineAuthorityAttemptRecord,
  type EncryptedOfflineAuthorityRecord,
  type LocalPosDevice,
  posBrowserCrypto,
  posDeviceDatabase,
  signDevicePayload,
} from "./pos-device";

const cacheKeyId = "offline-authority-cache-key-v1";
const cacheSchemaVersion = 1;
const requiredCapabilities = ["pos.shift.operate", "pos.sale.create"] as const;

export type OfflineAuthorityScope = Readonly<{
  companyId: string;
  branchId: string;
  deviceId: string;
  cashierUserId: string;
}>;
export type OfflineAuthorityVerificationKey = Readonly<{
  algorithm: "ES256";
  keyId: string;
  publicKeyJwk: JsonWebKey;
}>;
export type OfflineAuthorityClaims = Readonly<{
  companyId: string;
  branchId: string;
  deviceId: string;
  cashierUserId: string;
  grantId: string;
  issuedAt: string;
  expiresAt: string;
  policyId: string;
  policyVersion: number;
  capabilities: readonly (typeof requiredCapabilities)[number][];
}>;
export type CachedOfflineAuthority = OfflineAuthorityClaims &
  Readonly<{
    token: string;
  }>;

type Challenge = Readonly<{
  challengeId: string;
  deviceId: string;
  expiresAt: string;
  nonce: string;
}>;
type GrantIssueResponse = Readonly<{
  correlationId: string;
  data: Readonly<{
    grantId: string;
    deviceId: string;
    issuedAt: string;
    expiresAt: string;
    policyId: string;
    policyVersion: number;
    capabilities: readonly string[];
    token: string;
  }>;
}>;
export type EncryptedPosCachePayload = Readonly<{
  encryptedPayload: ArrayBuffer;
  initializationVector: ArrayBuffer;
}>;
type PendingAttempt = Readonly<{
  version: 1;
  challengeIdempotencyKey: string;
  issueIdempotencyKey: string;
  challenge: Challenge | null;
  signature: string | null;
}>;
type StoredAuthorityPayload = Readonly<{
  version: 1;
  token: string;
  verificationKey: OfflineAuthorityVerificationKey;
}>;

function authorityId(scope: OfflineAuthorityScope): string {
  return `${scope.companyId}:${scope.branchId}:${scope.deviceId}:${scope.cashierUserId}`;
}
function recordAad(
  type:
    | "authority"
    | "attempt"
    | "cashier-pin"
    | "cashier-shift"
    | "sale-outbox"
    | "pos-catalogue",
  scope: OfflineAuthorityScope,
): ArrayBuffer {
  return arrayBuffer(
    new TextEncoder().encode(
      `ledgerlite:offline-authority-cache:v${cacheSchemaVersion}:${type}:${authorityId(scope)}`,
    ),
  );
}
function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function base64UrlBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1)
    throw new Error("Offline authority token uses invalid base64url encoding.");
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function object(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(message);
  return value as Record<string, unknown>;
}
function string(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(message);
  return value;
}
function timestamp(value: unknown, message: string): number {
  const parsed = Date.parse(string(value, message));
  if (!Number.isFinite(parsed)) throw new Error(message);
  return parsed;
}
function json(bytes: Uint8Array, message: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    throw new Error(message, { cause });
  }
  return object(value, message);
}
function parseVerificationKey(value: unknown): OfflineAuthorityVerificationKey {
  const input = object(value, "Offline authority verification key is invalid.");
  const publicKey = object(
    input.publicKeyJwk,
    "Offline authority verification key is invalid.",
  );
  if (
    input.algorithm !== "ES256" ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(
      string(input.keyId, "Offline authority verification key is invalid."),
    ) ||
    publicKey.kty !== "EC" ||
    publicKey.crv !== "P-256" ||
    typeof publicKey.x !== "string" ||
    typeof publicKey.y !== "string"
  )
    throw new Error("Offline authority verification key is invalid.");
  return {
    algorithm: "ES256",
    keyId: input.keyId as string,
    publicKeyJwk: publicKey as JsonWebKey,
  };
}
function claims(
  value: Record<string, unknown>,
  scope: OfflineAuthorityScope,
  now: number,
): OfflineAuthorityClaims {
  const capabilities = value.capabilities;
  if (
    !Array.isArray(capabilities) ||
    capabilities.length !== requiredCapabilities.length ||
    !capabilities.every((capability) =>
      requiredCapabilities.includes(
        capability as (typeof requiredCapabilities)[number],
      ),
    )
  )
    throw new Error("Offline authority has an unsupported capability set.");
  const issuedAt = string(
    value.issuedAt,
    "Offline authority issue time is invalid.",
  );
  const expiresAt = string(
    value.expiresAt,
    "Offline authority expiry time is invalid.",
  );
  const issuedAtMs = timestamp(
    issuedAt,
    "Offline authority issue time is invalid.",
  );
  const expiresAtMs = timestamp(
    expiresAt,
    "Offline authority expiry time is invalid.",
  );
  if (expiresAtMs <= issuedAtMs || expiresAtMs <= now)
    throw new Error("Offline authority has expired.");
  if (
    value.issuer !== "ledgerlite" ||
    value.schemaVersion !== 1 ||
    value.companyId !== scope.companyId ||
    value.branchId !== scope.branchId ||
    value.deviceId !== scope.deviceId ||
    value.cashierUserId !== scope.cashierUserId ||
    !Number.isInteger(value.policyVersion) ||
    (value.policyVersion as number) < 1
  )
    throw new Error("Offline authority does not match this POS context.");
  return {
    companyId: scope.companyId,
    branchId: scope.branchId,
    deviceId: scope.deviceId,
    cashierUserId: scope.cashierUserId,
    grantId: string(value.grantId, "Offline authority grant ID is invalid."),
    issuedAt,
    expiresAt,
    policyId: string(value.policyId, "Offline authority policy ID is invalid."),
    policyVersion: value.policyVersion as number,
    capabilities: requiredCapabilities,
  };
}

export async function verifyOfflineAuthorityToken(
  browserCrypto: Crypto,
  token: string,
  verificationKey: OfflineAuthorityVerificationKey,
  scope: OfflineAuthorityScope,
  now = Date.now(),
): Promise<OfflineAuthorityClaims> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0))
    throw new Error("Offline authority token is malformed.");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = json(
    base64UrlBytes(encodedHeader),
    "Offline authority token header is invalid.",
  );
  if (
    header.alg !== "ES256" ||
    header.typ !== "LL-Offline-Grant" ||
    header.kid !== verificationKey.keyId
  )
    throw new Error("Offline authority token is signed by an unexpected key.");
  const publicKey = await browserCrypto.subtle.importKey(
    "jwk",
    verificationKey.publicKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const isValid = await browserCrypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    arrayBuffer(base64UrlBytes(encodedSignature)),
    arrayBuffer(new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)),
  );
  if (!isValid)
    throw new Error("Offline authority token signature is invalid.");
  return claims(
    json(
      base64UrlBytes(encodedPayload),
      "Offline authority token payload is invalid.",
    ),
    scope,
    now,
  );
}

async function cacheEncryptionKey(browserCrypto: Crypto): Promise<CryptoKey> {
  const database = posDeviceDatabase();
  const existing = await database.cacheKeys.get(cacheKeyId);
  if (existing) return existing.encryptionKey;
  const encryptionKey = await browserCrypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  try {
    await database.cacheKeys.add({
      id: cacheKeyId,
      encryptionKey,
      createdAt: new Date().toISOString(),
    });
    return encryptionKey;
  } catch {
    const concurrentKey = await database.cacheKeys.get(cacheKeyId);
    if (concurrentKey) return concurrentKey.encryptionKey;
    throw new Error("Could not create the encrypted POS authority cache.");
  }
}
export async function encryptOfflinePosCache(
  browserCrypto: Crypto,
  type:
    | "authority"
    | "attempt"
    | "cashier-pin"
    | "cashier-shift"
    | "sale-outbox"
    | "pos-catalogue",
  scope: OfflineAuthorityScope,
  payload: unknown,
): Promise<EncryptedPosCachePayload> {
  const initializationVector = browserCrypto.getRandomValues(
    new Uint8Array(12),
  );
  const encryptedPayload = await browserCrypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: arrayBuffer(initializationVector),
      additionalData: recordAad(type, scope),
    },
    await cacheEncryptionKey(browserCrypto),
    arrayBuffer(new TextEncoder().encode(JSON.stringify(payload))),
  );
  return {
    encryptedPayload,
    initializationVector: arrayBuffer(initializationVector),
  };
}
export async function decryptOfflinePosCache<T>(
  browserCrypto: Crypto,
  type:
    | "authority"
    | "attempt"
    | "cashier-pin"
    | "cashier-shift"
    | "sale-outbox"
    | "pos-catalogue",
  scope: OfflineAuthorityScope,
  record: EncryptedPosCachePayload,
): Promise<T> {
  try {
    const decrypted = await browserCrypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: record.initializationVector,
        additionalData: recordAad(type, scope),
      },
      await cacheEncryptionKey(browserCrypto),
      record.encryptedPayload,
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  } catch {
    throw new Error("Encrypted POS authority cache could not be verified.");
  }
}
function isChallenge(value: unknown): value is Challenge {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.challengeId === "string" &&
    typeof candidate.deviceId === "string" &&
    typeof candidate.expiresAt === "string" &&
    typeof candidate.nonce === "string"
  );
}
function isAttempt(value: unknown): value is PendingAttempt {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.challengeIdempotencyKey === "string" &&
    typeof candidate.issueIdempotencyKey === "string" &&
    (candidate.challenge === null || isChallenge(candidate.challenge)) &&
    (candidate.signature === null || typeof candidate.signature === "string")
  );
}
async function loadAttempt(
  browserCrypto: Crypto,
  scope: OfflineAuthorityScope,
): Promise<PendingAttempt | undefined> {
  const database = posDeviceDatabase();
  const record = await database.offlineAuthorityAttempts.get(
    authorityId(scope),
  );
  if (!record) return undefined;
  try {
    const attempt = await decryptOfflinePosCache<unknown>(
      browserCrypto,
      "attempt",
      scope,
      record,
    );
    if (!isAttempt(attempt)) throw new Error();
    return attempt;
  } catch {
    await database.offlineAuthorityAttempts.delete(record.id);
    return undefined;
  }
}
async function storeAttempt(
  browserCrypto: Crypto,
  scope: OfflineAuthorityScope,
  attempt: PendingAttempt,
): Promise<void> {
  const encrypted = await encryptOfflinePosCache(
    browserCrypto,
    "attempt",
    scope,
    attempt,
  );
  const record: EncryptedOfflineAuthorityAttemptRecord = {
    id: authorityId(scope),
    companyId: scope.companyId,
    branchId: scope.branchId,
    deviceId: scope.deviceId,
    cashierUserId: scope.cashierUserId,
    ...encrypted,
    updatedAt: new Date().toISOString(),
  };
  await posDeviceDatabase().offlineAuthorityAttempts.put(record);
}
function newAttempt(browserCrypto: Crypto): PendingAttempt {
  return {
    version: 1,
    challengeIdempotencyKey: browserCrypto.randomUUID(),
    issueIdempotencyKey: browserCrypto.randomUUID(),
    challenge: null,
    signature: null,
  };
}
function activeChallenge(attempt: PendingAttempt): boolean {
  return (
    attempt.challenge !== null &&
    attempt.challenge.expiresAt !== "" &&
    Date.parse(attempt.challenge.expiresAt) > Date.now()
  );
}
function commandHeaders(idempotencyKey: string) {
  return {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
  };
}
function assertIssuedResponse(
  response: GrantIssueResponse,
  authority: OfflineAuthorityClaims,
): void {
  const grant = response.data;
  if (
    grant.grantId !== authority.grantId ||
    grant.deviceId !== authority.deviceId ||
    grant.issuedAt !== authority.issuedAt ||
    grant.expiresAt !== authority.expiresAt ||
    grant.policyId !== authority.policyId ||
    grant.policyVersion !== authority.policyVersion ||
    grant.capabilities.length !== authority.capabilities.length ||
    !grant.capabilities.every((capability) =>
      authority.capabilities.includes(
        capability as (typeof requiredCapabilities)[number],
      ),
    )
  )
    throw new Error(
      "The issued offline authority response does not match its token.",
    );
}

export async function refreshOfflineAuthority(input: {
  companyId: string;
  branchId: string;
  cashierUserId: string;
  device: LocalPosDevice;
}): Promise<CachedOfflineAuthority> {
  if (input.device.state !== "registered" || !input.device.deviceId)
    throw new Error(
      "Register this browser before refreshing offline authority.",
    );
  if (
    input.device.companyId !== input.companyId ||
    input.device.branchId !== input.branchId
  )
    throw new Error(
      "This browser device does not match the selected POS branch.",
    );
  const browserCrypto = posBrowserCrypto();
  const scope: OfflineAuthorityScope = {
    companyId: input.companyId,
    branchId: input.branchId,
    deviceId: input.device.deviceId,
    cashierUserId: input.cashierUserId,
  };
  const verificationKey = parseVerificationKey(
    await request<unknown>("/pos/offline-grants/verification-key"),
  );
  let attempt = await loadAttempt(browserCrypto, scope);
  if (!attempt || !activeChallenge(attempt)) {
    attempt = newAttempt(browserCrypto);
    await storeAttempt(browserCrypto, scope, attempt);
  }
  if (!attempt.challenge) {
    const challenge = await request<Challenge>(
      `/companies/${scope.companyId}/branches/${scope.branchId}/pos/offline-grants/challenges`,
      {
        method: "POST",
        headers: commandHeaders(attempt.challengeIdempotencyKey),
        body: JSON.stringify({ deviceId: scope.deviceId }),
      },
    );
    if (
      challenge.deviceId !== scope.deviceId ||
      !activeChallenge({ ...attempt, challenge })
    )
      throw new Error(
        "The server returned an invalid offline authority challenge.",
      );
    attempt = { ...attempt, challenge, signature: null };
    await storeAttempt(browserCrypto, scope, attempt);
  }
  if (!attempt.signature) {
    const challenge = attempt.challenge;
    if (!challenge)
      throw new Error("Offline authority challenge was not persisted.");
    const signed = await signDevicePayload(
      input.device,
      offlineGrantChallengePayload(challenge.challengeId, challenge.nonce),
    );
    attempt = {
      ...attempt,
      signature: base64Url(new Uint8Array(signed)),
    };
    await storeAttempt(browserCrypto, scope, attempt);
  }
  const challenge = attempt.challenge;
  const signature = attempt.signature;
  if (!challenge || !signature)
    throw new Error("Offline authority proof was not persisted.");
  const issued = await request<GrantIssueResponse>(
    `/companies/${scope.companyId}/branches/${scope.branchId}/pos/offline-grants`,
    {
      method: "POST",
      headers: commandHeaders(attempt.issueIdempotencyKey),
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
      }),
    },
  );
  const verified = await verifyOfflineAuthorityToken(
    browserCrypto,
    issued.data.token,
    verificationKey,
    scope,
  );
  assertIssuedResponse(issued, verified);
  const encrypted = await encryptOfflinePosCache(
    browserCrypto,
    "authority",
    scope,
    {
      version: 1,
      token: issued.data.token,
      verificationKey,
    } satisfies StoredAuthorityPayload,
  );
  const record: EncryptedOfflineAuthorityRecord = {
    id: authorityId(scope),
    companyId: scope.companyId,
    branchId: scope.branchId,
    deviceId: scope.deviceId,
    cashierUserId: scope.cashierUserId,
    grantId: verified.grantId,
    issuedAt: verified.issuedAt,
    expiresAt: verified.expiresAt,
    ...encrypted,
    updatedAt: new Date().toISOString(),
  };
  const database = posDeviceDatabase();
  await database.transaction(
    "rw",
    database.offlineAuthorities,
    database.offlineAuthorityAttempts,
    async () => {
      await database.offlineAuthorities.put(record);
      await database.offlineAuthorityAttempts.delete(record.id);
    },
  );
  return { ...verified, token: issued.data.token };
}

export async function cachedOfflineAuthority(
  scope: OfflineAuthorityScope,
): Promise<CachedOfflineAuthority | undefined> {
  const browserCrypto = posBrowserCrypto();
  const database = posDeviceDatabase();
  const record = await database.offlineAuthorities.get(authorityId(scope));
  if (!record) return undefined;
  if (Date.parse(record.expiresAt) <= Date.now()) {
    await database.offlineAuthorities.delete(record.id);
    return undefined;
  }
  try {
    const payload = await decryptOfflinePosCache<unknown>(
      browserCrypto,
      "authority",
      scope,
      record,
    );
    const stored = object(payload, "Encrypted POS authority cache is invalid.");
    if (stored.version !== 1 || typeof stored.token !== "string")
      throw new Error("Encrypted POS authority cache is invalid.");
    const verificationKey = parseVerificationKey(stored.verificationKey);
    const verified = await verifyOfflineAuthorityToken(
      browserCrypto,
      stored.token,
      verificationKey,
      scope,
    );
    if (
      verified.grantId !== record.grantId ||
      verified.issuedAt !== record.issuedAt ||
      verified.expiresAt !== record.expiresAt
    )
      throw new Error(
        "Encrypted POS authority cache does not match its metadata.",
      );
    return { ...verified, token: stored.token };
  } catch {
    await database.offlineAuthorities.delete(record.id);
    return undefined;
  }
}
