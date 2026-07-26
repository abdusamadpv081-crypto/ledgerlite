import Dexie, { type Table } from "dexie";

export const POS_DEVICE_APP_VERSION = "0.1.0";
export const POS_DEVICE_LOCAL_SCHEMA_VERSION = 1;
export const POS_OFFLINE_AUTHORITY_CACHE_VERSION = 1;
export const POS_SALE_OUTBOX_VERSION = 1;
export const POS_CATALOGUE_CACHE_VERSION = 1;

export type DevicePublicKeyJwk = Readonly<{
  alg: "ES256";
  crv: "P-256";
  ext: true;
  key_ops: readonly ["verify"];
  kty: "EC";
  x: string;
  y: string;
}>;
export type LocalPosDevice = Readonly<{
  id: string;
  companyId: string;
  branchId: string;
  displayName: string;
  publicKeyJwk: DevicePublicKeyJwk;
  privateSigningKey: CryptoKey;
  registrationIdempotencyKey: string;
  state: "pending" | "registered";
  deviceId: string | null;
  publicKeyFingerprint: string | null;
  updatedAt: string;
}>;

export type PosCacheKeyRecord = Readonly<{
  id: "offline-authority-cache-key-v1";
  encryptionKey: CryptoKey;
  createdAt: string;
}>;
export type EncryptedOfflineAuthorityRecord = Readonly<{
  id: string;
  companyId: string;
  branchId: string;
  deviceId: string;
  cashierUserId: string;
  grantId: string;
  issuedAt: string;
  expiresAt: string;
  encryptedPayload: ArrayBuffer;
  initializationVector: ArrayBuffer;
  updatedAt: string;
}>;
export type EncryptedOfflineAuthorityAttemptRecord = Readonly<{
  id: string;
  companyId: string;
  branchId: string;
  deviceId: string;
  cashierUserId: string;
  encryptedPayload: ArrayBuffer;
  initializationVector: ArrayBuffer;
  updatedAt: string;
}>;
export type EncryptedCashierPinRecord = Readonly<{
  id: string;
  companyId: string;
  branchId: string;
  deviceId: string;
  cashierUserId: string;
  pinVersion: number;
  encryptedPayload: ArrayBuffer;
  initializationVector: ArrayBuffer;
  updatedAt: string;
}>;
export type EncryptedCashShiftRecord = Readonly<{
  id: string;
  companyId: string;
  branchId: string;
  deviceId: string;
  cashierUserId: string;
  shiftId: string;
  encryptedPayload: ArrayBuffer;
  initializationVector: ArrayBuffer;
  updatedAt: string;
}>;
export type EncryptedPosSaleOutboxRecord = Readonly<{
  id: string;
  companyId: string;
  branchId: string;
  deviceId: string;
  cashierUserId: string;
  shiftId: string;
  authorityGrantId: string;
  status: "pending_sync";
  occurredAt: string;
  encryptedPayload: ArrayBuffer;
  initializationVector: ArrayBuffer;
  updatedAt: string;
}>;
export type EncryptedPosCatalogueRecord = Readonly<{
  id: string;
  companyId: string;
  branchId: string;
  deviceId: string;
  cashierUserId: string;
  refreshedAt: string;
  encryptedPayload: ArrayBuffer;
  initializationVector: ArrayBuffer;
  updatedAt: string;
}>;

export class PosDeviceDatabase extends Dexie {
  devices!: Table<LocalPosDevice, string>;
  cacheKeys!: Table<PosCacheKeyRecord, string>;
  offlineAuthorities!: Table<EncryptedOfflineAuthorityRecord, string>;
  offlineAuthorityAttempts!: Table<
    EncryptedOfflineAuthorityAttemptRecord,
    string
  >;
  cashierPins!: Table<EncryptedCashierPinRecord, string>;
  cashierShifts!: Table<EncryptedCashShiftRecord, string>;
  saleOutbox!: Table<EncryptedPosSaleOutboxRecord, string>;
  posCatalogues!: Table<EncryptedPosCatalogueRecord, string>;

  constructor() {
    super("ledgerlite-pos");
    this.version(1).stores({
      devices: "&id, companyId, branchId, state, deviceId, updatedAt",
    });
    this.version(2).stores({
      devices: "&id, companyId, branchId, state, deviceId, updatedAt",
      cacheKeys: "&id, createdAt",
      offlineAuthorities:
        "&id, companyId, branchId, deviceId, cashierUserId, expiresAt, updatedAt",
      offlineAuthorityAttempts:
        "&id, companyId, branchId, deviceId, cashierUserId, updatedAt",
    });
    this.version(3).stores({
      devices: "&id, companyId, branchId, state, deviceId, updatedAt",
      cacheKeys: "&id, createdAt",
      offlineAuthorities:
        "&id, companyId, branchId, deviceId, cashierUserId, expiresAt, updatedAt",
      offlineAuthorityAttempts:
        "&id, companyId, branchId, deviceId, cashierUserId, updatedAt",
      cashierPins:
        "&id, companyId, branchId, deviceId, cashierUserId, pinVersion, updatedAt",
    });
    this.version(4).stores({
      devices: "&id, companyId, branchId, state, deviceId, updatedAt",
      cacheKeys: "&id, createdAt",
      offlineAuthorities:
        "&id, companyId, branchId, deviceId, cashierUserId, expiresAt, updatedAt",
      offlineAuthorityAttempts:
        "&id, companyId, branchId, deviceId, cashierUserId, updatedAt",
      cashierPins:
        "&id, companyId, branchId, deviceId, cashierUserId, pinVersion, updatedAt",
      cashierShifts:
        "&id, companyId, branchId, deviceId, cashierUserId, shiftId, updatedAt",
    });
    this.version(5).stores({
      devices: "&id, companyId, branchId, state, deviceId, updatedAt",
      cacheKeys: "&id, createdAt",
      offlineAuthorities:
        "&id, companyId, branchId, deviceId, cashierUserId, expiresAt, updatedAt",
      offlineAuthorityAttempts:
        "&id, companyId, branchId, deviceId, cashierUserId, updatedAt",
      cashierPins:
        "&id, companyId, branchId, deviceId, cashierUserId, pinVersion, updatedAt",
      cashierShifts:
        "&id, companyId, branchId, deviceId, cashierUserId, shiftId, updatedAt",
      saleOutbox:
        "&id, companyId, branchId, deviceId, cashierUserId, shiftId, authorityGrantId, status, occurredAt, updatedAt",
    });
    this.version(6).stores({
      devices: "&id, companyId, branchId, state, deviceId, updatedAt",
      cacheKeys: "&id, createdAt",
      offlineAuthorities:
        "&id, companyId, branchId, deviceId, cashierUserId, expiresAt, updatedAt",
      offlineAuthorityAttempts:
        "&id, companyId, branchId, deviceId, cashierUserId, updatedAt",
      cashierPins:
        "&id, companyId, branchId, deviceId, cashierUserId, pinVersion, updatedAt",
      cashierShifts:
        "&id, companyId, branchId, deviceId, cashierUserId, shiftId, updatedAt",
      saleOutbox:
        "&id, companyId, branchId, deviceId, cashierUserId, shiftId, authorityGrantId, status, occurredAt, updatedAt",
      posCatalogues:
        "&id, companyId, branchId, deviceId, cashierUserId, refreshedAt, updatedAt",
    });
  }
}

let database: PosDeviceDatabase | undefined;

function deviceId(companyId: string, branchId: string) {
  return `${companyId}:${branchId}`;
}

export function posDeviceDatabase(): PosDeviceDatabase {
  if (typeof window === "undefined")
    throw new Error("POS device storage is available only in a browser.");
  database ??= new PosDeviceDatabase();
  return database;
}

export function posBrowserCrypto(): Crypto {
  if (typeof window === "undefined" || !window.isSecureContext)
    throw new Error(
      "Device registration needs HTTPS (or localhost) so the browser can protect its signing key.",
    );
  if (!window.crypto?.subtle)
    throw new Error(
      "This browser does not support the Web Crypto API required for POS devices.",
    );
  return window.crypto;
}

function publicKeyJwk(jwk: JsonWebKey): DevicePublicKeyJwk {
  if (!jwk.x || !jwk.y)
    throw new Error("The browser returned an invalid P-256 public key.");
  return {
    alg: "ES256",
    crv: "P-256",
    ext: true,
    key_ops: ["verify"],
    kty: "EC",
    x: jwk.x,
    y: jwk.y,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || ["boolean", "number", "string"].includes(typeof value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Device key contains a non-JSON value.");
}

export function canUseDeviceCrypto(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    Boolean(window.crypto?.subtle)
  );
}

export async function localDevice(
  companyId: string,
  branchId: string,
): Promise<LocalPosDevice | undefined> {
  return posDeviceDatabase().devices.get(deviceId(companyId, branchId));
}

export async function prepareDeviceRegistration(input: {
  companyId: string;
  branchId: string;
  displayName: string;
}): Promise<LocalPosDevice> {
  const crypto = posBrowserCrypto();
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  if (
    !(keys.privateKey instanceof CryptoKey) ||
    !(keys.publicKey instanceof CryptoKey)
  )
    throw new Error(
      "The browser did not generate a usable POS device key pair.",
    );

  const pending: LocalPosDevice = {
    id: deviceId(input.companyId, input.branchId),
    companyId: input.companyId,
    branchId: input.branchId,
    displayName: input.displayName,
    publicKeyJwk: publicKeyJwk(
      await crypto.subtle.exportKey("jwk", keys.publicKey),
    ),
    privateSigningKey: keys.privateKey,
    registrationIdempotencyKey: crypto.randomUUID(),
    state: "pending",
    deviceId: null,
    publicKeyFingerprint: null,
    updatedAt: new Date().toISOString(),
  };
  await posDeviceDatabase().devices.put(pending);
  return pending;
}

export async function completeDeviceRegistration(
  pending: LocalPosDevice,
  response: Readonly<{
    id: string;
    publicKeyFingerprint: string;
  }>,
): Promise<LocalPosDevice> {
  const registered: LocalPosDevice = {
    ...pending,
    state: "registered",
    deviceId: response.id,
    publicKeyFingerprint: response.publicKeyFingerprint,
    updatedAt: new Date().toISOString(),
  };
  await posDeviceDatabase().devices.put(registered);
  return registered;
}

export async function publicKeyFingerprint(
  publicKey: DevicePublicKeyJwk,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(publicKey));
  const digest = await posBrowserCrypto().subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function signDevicePayload(
  device: LocalPosDevice,
  payload: Uint8Array,
): Promise<ArrayBuffer> {
  const signingBytes = new Uint8Array(payload.byteLength);
  signingBytes.set(payload);
  return posBrowserCrypto().subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    device.privateSigningKey,
    signingBytes.buffer,
  );
}
