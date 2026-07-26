import {
  decryptOfflinePosCache,
  encryptOfflinePosCache,
  type CachedOfflineAuthority,
  type OfflineAuthorityScope,
} from "./pos-offline-authority";
import {
  type EncryptedCashierPinRecord,
  posBrowserCrypto,
  posDeviceDatabase,
} from "./pos-device";

const localPinVersion = 1;
const pbkdf2Iterations = 600_000;

export type CashierPinPolicy = Readonly<{
  id: string;
  version: number;
  minLength: number;
  maxLength: number;
  maxFailedAttempts: number;
  coolOffMinutes: number;
  maxSessionHours: number;
}>;
export type CashierPinSetProfile = Readonly<{
  pinVersion: number;
  changedAt: string;
  policy: CashierPinPolicy;
}>;
export type CachedCashierPin = Readonly<{
  pinVersion: number;
  policy: CashierPinPolicy;
  failedAttempts: number;
  lockedUntil: string | null;
  changedAt: string;
}>;
export type OfflinePinUnlockResult =
  | Readonly<{ status: "unlocked"; expiresAt: string }>
  | Readonly<{
      status: "invalid";
      remainingAttempts: number;
    }>
  | Readonly<{ status: "locked"; lockedUntil: string }>;

type StoredCashierPin = CachedCashierPin &
  Readonly<{
    version: 1;
    salt: string;
    verifier: string;
  }>;

function pinId(scope: OfflineAuthorityScope): string {
  return `${scope.companyId}:${scope.branchId}:${scope.deviceId}:${scope.cashierUserId}`;
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
    throw new Error("Cached cashier PIN verifier is invalid.");
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Cached cashier PIN verifier is invalid.");
  return value as Record<string, unknown>;
}
function positiveInteger(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1)
    throw new Error("Cached cashier PIN verifier is invalid.");
  return value as number;
}
function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("Cached cashier PIN verifier is invalid.");
  return value;
}
function policy(value: unknown): CashierPinPolicy {
  const candidate = object(value);
  const minLength = positiveInteger(candidate.minLength);
  const maxLength = positiveInteger(candidate.maxLength);
  const maxFailedAttempts = positiveInteger(candidate.maxFailedAttempts);
  const coolOffMinutes = positiveInteger(candidate.coolOffMinutes);
  const maxSessionHours = positiveInteger(candidate.maxSessionHours);
  if (
    typeof candidate.id !== "string" ||
    !Number.isInteger(candidate.version) ||
    (candidate.version as number) < 1 ||
    minLength < 8 ||
    maxLength < minLength ||
    maxLength > 16 ||
    maxFailedAttempts > 10 ||
    coolOffMinutes > 1440 ||
    maxSessionHours > 24
  )
    throw new Error("Cached cashier PIN policy is invalid.");
  return {
    id: candidate.id,
    version: candidate.version as number,
    minLength,
    maxLength,
    maxFailedAttempts,
    coolOffMinutes,
    maxSessionHours,
  };
}
function storedPin(value: unknown): StoredCashierPin {
  const candidate = object(value);
  if (
    candidate.version !== localPinVersion ||
    !Number.isInteger(candidate.pinVersion) ||
    (candidate.pinVersion as number) < 1 ||
    !Number.isInteger(candidate.failedAttempts) ||
    (candidate.failedAttempts as number) < 0 ||
    typeof candidate.changedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.changedAt)) ||
    typeof candidate.salt !== "string" ||
    typeof candidate.verifier !== "string"
  )
    throw new Error("Cached cashier PIN verifier is invalid.");
  const salt = base64UrlBytes(candidate.salt);
  const verifier = base64UrlBytes(candidate.verifier);
  if (salt.byteLength !== 16 || verifier.byteLength !== 32)
    throw new Error("Cached cashier PIN verifier is invalid.");
  return {
    version: localPinVersion,
    pinVersion: candidate.pinVersion as number,
    policy: policy(candidate.policy),
    failedAttempts: candidate.failedAttempts as number,
    lockedUntil: nullableTimestamp(candidate.lockedUntil),
    changedAt: candidate.changedAt,
    salt: candidate.salt,
    verifier: candidate.verifier,
  };
}
function visibleProfile(value: StoredCashierPin): CachedCashierPin {
  return {
    pinVersion: value.pinVersion,
    policy: value.policy,
    failedAttempts: value.failedAttempts,
    lockedUntil: value.lockedUntil,
    changedAt: value.changedAt,
  };
}
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  const maximumLength = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < maximumLength; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

export async function deriveCashierPinVerifier(
  browserCrypto: Crypto,
  pin: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const material = await browserCrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await browserCrypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: arrayBuffer(salt),
      iterations: pbkdf2Iterations,
      hash: "SHA-256",
    },
    material,
    256,
  );
  return new Uint8Array(derived);
}

async function store(
  browserCrypto: Crypto,
  scope: OfflineAuthorityScope,
  value: StoredCashierPin,
): Promise<void> {
  const encrypted = await encryptOfflinePosCache(
    browserCrypto,
    "cashier-pin",
    scope,
    value,
  );
  const record: EncryptedCashierPinRecord = {
    id: pinId(scope),
    companyId: scope.companyId,
    branchId: scope.branchId,
    deviceId: scope.deviceId,
    cashierUserId: scope.cashierUserId,
    pinVersion: value.pinVersion,
    ...encrypted,
    updatedAt: new Date().toISOString(),
  };
  await posDeviceDatabase().cashierPins.put(record);
}
async function load(
  browserCrypto: Crypto,
  scope: OfflineAuthorityScope,
): Promise<StoredCashierPin | undefined> {
  const database = posDeviceDatabase();
  const record = await database.cashierPins.get(pinId(scope));
  if (!record) return undefined;
  try {
    return storedPin(
      await decryptOfflinePosCache<unknown>(
        browserCrypto,
        "cashier-pin",
        scope,
        record,
      ),
    );
  } catch {
    await database.cashierPins.delete(record.id);
    return undefined;
  }
}

export async function enrollCashierPin(
  scope: OfflineAuthorityScope,
  pin: string,
  profile: CashierPinSetProfile,
): Promise<CachedCashierPin> {
  const browserCrypto = posBrowserCrypto();
  const nextPolicy = policy(profile.policy);
  if (
    !/^\d+$/.test(pin) ||
    pin.length < nextPolicy.minLength ||
    pin.length > nextPolicy.maxLength
  )
    throw new Error(
      `POS PIN must contain ${nextPolicy.minLength}–${nextPolicy.maxLength} digits.`,
    );
  if (
    !Number.isInteger(profile.pinVersion) ||
    profile.pinVersion < 1 ||
    !Number.isFinite(Date.parse(profile.changedAt))
  )
    throw new Error("The server returned an invalid cashier PIN profile.");
  const salt = browserCrypto.getRandomValues(new Uint8Array(16));
  const verifier = await deriveCashierPinVerifier(browserCrypto, pin, salt);
  const stored: StoredCashierPin = {
    version: localPinVersion,
    pinVersion: profile.pinVersion,
    policy: nextPolicy,
    failedAttempts: 0,
    lockedUntil: null,
    changedAt: profile.changedAt,
    salt: base64Url(salt),
    verifier: base64Url(verifier),
  };
  await store(browserCrypto, scope, stored);
  return visibleProfile(stored);
}

export async function cachedCashierPin(
  scope: OfflineAuthorityScope,
): Promise<CachedCashierPin | undefined> {
  const stored = await load(posBrowserCrypto(), scope);
  return stored ? visibleProfile(stored) : undefined;
}

export async function unlockCashierPin(
  scope: OfflineAuthorityScope,
  pin: string,
  authority: Pick<CachedOfflineAuthority, "expiresAt">,
  now = Date.now(),
): Promise<OfflinePinUnlockResult> {
  const browserCrypto = posBrowserCrypto();
  const stored = await load(browserCrypto, scope);
  if (!stored)
    throw new Error("Set this cashier PIN online before using offline unlock.");
  if (stored.lockedUntil && Date.parse(stored.lockedUntil) > now)
    return { status: "locked", lockedUntil: stored.lockedUntil };
  const verifier = await deriveCashierPinVerifier(
    browserCrypto,
    pin,
    base64UrlBytes(stored.salt),
  );
  if (!equalBytes(verifier, base64UrlBytes(stored.verifier))) {
    const failedAttempts = stored.failedAttempts + 1;
    if (failedAttempts >= stored.policy.maxFailedAttempts) {
      const lockedUntil = new Date(
        now + stored.policy.coolOffMinutes * 60 * 1000,
      ).toISOString();
      await store(browserCrypto, scope, {
        ...stored,
        failedAttempts,
        lockedUntil,
      });
      return { status: "locked", lockedUntil };
    }
    await store(browserCrypto, scope, { ...stored, failedAttempts });
    return {
      status: "invalid",
      remainingAttempts: stored.policy.maxFailedAttempts - failedAttempts,
    };
  }
  const expiresAt = Math.min(
    Date.parse(authority.expiresAt),
    now + stored.policy.maxSessionHours * 60 * 60 * 1000,
  );
  if (!Number.isFinite(expiresAt) || expiresAt <= now)
    throw new Error("Offline authority has expired.");
  await store(browserCrypto, scope, {
    ...stored,
    failedAttempts: 0,
    lockedUntil: null,
  });
  return { status: "unlocked", expiresAt: new Date(expiresAt).toISOString() };
}
