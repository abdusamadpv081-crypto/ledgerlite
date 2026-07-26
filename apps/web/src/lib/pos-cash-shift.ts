import {
  decryptOfflinePosCache,
  encryptOfflinePosCache,
  type OfflineAuthorityScope,
} from "./pos-offline-authority";
import {
  type EncryptedCashShiftRecord,
  posBrowserCrypto,
  posDeviceDatabase,
} from "./pos-device";

export type CachedCashShift = Readonly<{
  id: string;
  branchId: string;
  deviceId: string;
  cashierUserId: string;
  status: "open" | "close_requested" | "closed" | "voided";
  currencyCode: string;
  openingFloat: string;
  policyId: string;
  policyVersion: number;
  openedAt: string;
}>;

type StoredCashShift = CachedCashShift & Readonly<{ version: 1 }>;

function shiftId(scope: OfflineAuthorityScope): string {
  return `${scope.companyId}:${scope.branchId}:${scope.deviceId}:${scope.cashierUserId}`;
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Cached cash shift is invalid.");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error("Cached cash shift is invalid.");
  return value;
}
function timestamp(value: unknown): string {
  const result = string(value);
  if (!Number.isFinite(Date.parse(result)))
    throw new Error("Cached cash shift is invalid.");
  return result;
}
function positiveInteger(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1)
    throw new Error("Cached cash shift is invalid.");
  return value as number;
}
function stored(value: unknown, scope: OfflineAuthorityScope): StoredCashShift {
  const candidate = object(value);
  const status = candidate.status;
  if (
    candidate.version !== 1 ||
    candidate.branchId !== scope.branchId ||
    candidate.deviceId !== scope.deviceId ||
    candidate.cashierUserId !== scope.cashierUserId ||
    !["open", "close_requested", "closed", "voided"].includes(
      status as string,
    ) ||
    !/^[A-Z]{3}$/.test(string(candidate.currencyCode)) ||
    !/^(?:0|[1-9]\d{0,11})\.\d{2}$/.test(string(candidate.openingFloat))
  )
    throw new Error("Cached cash shift is invalid.");
  return {
    version: 1,
    id: string(candidate.id),
    branchId: scope.branchId,
    deviceId: scope.deviceId,
    cashierUserId: scope.cashierUserId,
    status: status as CachedCashShift["status"],
    currencyCode: candidate.currencyCode as string,
    openingFloat: candidate.openingFloat as string,
    policyId: string(candidate.policyId),
    policyVersion: positiveInteger(candidate.policyVersion),
    openedAt: timestamp(candidate.openedAt),
  };
}

export async function cacheCashShift(
  scope: OfflineAuthorityScope,
  value: CachedCashShift,
): Promise<CachedCashShift> {
  const shift = stored({ version: 1, ...value }, scope);
  const browserCrypto = posBrowserCrypto();
  const encrypted = await encryptOfflinePosCache(
    browserCrypto,
    "cashier-shift",
    scope,
    shift,
  );
  const record: EncryptedCashShiftRecord = {
    id: shiftId(scope),
    companyId: scope.companyId,
    branchId: scope.branchId,
    deviceId: scope.deviceId,
    cashierUserId: scope.cashierUserId,
    shiftId: shift.id,
    ...encrypted,
    updatedAt: new Date().toISOString(),
  };
  await posDeviceDatabase().cashierShifts.put(record);
  return shift;
}

export async function cachedCashShift(
  scope: OfflineAuthorityScope,
): Promise<CachedCashShift | undefined> {
  const database = posDeviceDatabase();
  const record = await database.cashierShifts.get(shiftId(scope));
  if (!record) return undefined;
  try {
    return stored(
      await decryptOfflinePosCache<unknown>(
        posBrowserCrypto(),
        "cashier-shift",
        scope,
        record,
      ),
      scope,
    );
  } catch {
    await database.cashierShifts.delete(record.id);
    return undefined;
  }
}

export async function clearCachedCashShift(
  scope: OfflineAuthorityScope,
): Promise<void> {
  await posDeviceDatabase().cashierShifts.delete(shiftId(scope));
}
