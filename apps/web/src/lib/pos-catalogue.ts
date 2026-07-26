import {
  decryptOfflinePosCache,
  encryptOfflinePosCache,
  type OfflineAuthorityScope,
} from "./pos-offline-authority";
import {
  POS_CATALOGUE_CACHE_VERSION,
  type EncryptedPosCatalogueRecord,
  posBrowserCrypto,
  posDeviceDatabase,
} from "./pos-device";
import type { PosCatalogueProduct } from "./pos-sale-outbox";
import { request } from "./api";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decimal = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;

export type CachedPosCatalogue = Readonly<{
  products: readonly PosCatalogueProduct[];
  refreshedAt: string;
}>;

type StoredPosCatalogue = CachedPosCatalogue &
  Readonly<{ version: typeof POS_CATALOGUE_CACHE_VERSION }>;

function catalogueId(scope: OfflineAuthorityScope): string {
  return `${scope.companyId}:${scope.branchId}:${scope.deviceId}:${scope.cashierUserId}`;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Cached POS catalogue is invalid.");
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error("Cached POS catalogue is invalid.");
  return value.trim();
}

function timestamp(value: unknown): string {
  const result = string(value);
  if (!Number.isFinite(Date.parse(result)))
    throw new Error("Cached POS catalogue is invalid.");
  return result;
}

function product(value: unknown): PosCatalogueProduct {
  const candidate = object(value);
  const productId = string(candidate.id);
  const unitPrice = string(candidate.unitPrice);
  const currency = string(candidate.currency);
  const taxTreatment = candidate.taxTreatment;
  if (
    !uuid.test(productId) ||
    !decimal.test(unitPrice) ||
    Number(unitPrice) <= 0 ||
    !/^[A-Z]{3}$/.test(currency) ||
    !["inclusive", "exclusive"].includes(taxTreatment as string) ||
    !(candidate.sku === null || typeof candidate.sku === "string")
  )
    throw new Error("Cached POS catalogue is invalid.");
  let taxCode: PosCatalogueProduct["taxCode"] = null;
  if (candidate.taxCode !== null) {
    const tax = object(candidate.taxCode);
    const rate = string(tax.rate);
    if (!uuid.test(string(tax.id)) || !decimal.test(rate) || Number(rate) > 1)
      throw new Error("Cached POS catalogue is invalid.");
    taxCode = {
      id: string(tax.id),
      code: string(tax.code),
      name: string(tax.name),
      rate,
    };
  }
  return {
    id: productId,
    name: string(candidate.name),
    sku: candidate.sku,
    unitPrice,
    currency,
    taxTreatment: taxTreatment as "inclusive" | "exclusive",
    taxCode,
  };
}

function stored(value: unknown): StoredPosCatalogue {
  const candidate = object(value);
  if (
    candidate.version !== POS_CATALOGUE_CACHE_VERSION ||
    !Array.isArray(candidate.products)
  )
    throw new Error("Cached POS catalogue is invalid.");
  const products = candidate.products.map(product);
  const uniqueIds = new Set(products.map((item) => item.id));
  if (uniqueIds.size !== products.length)
    throw new Error("Cached POS catalogue is invalid.");
  return {
    version: POS_CATALOGUE_CACHE_VERSION,
    products,
    refreshedAt: timestamp(candidate.refreshedAt),
  };
}

function visible(catalogue: StoredPosCatalogue): CachedPosCatalogue {
  return {
    products: catalogue.products,
    refreshedAt: catalogue.refreshedAt,
  };
}

export async function cachePosCatalogue(
  scope: OfflineAuthorityScope,
  value: CachedPosCatalogue,
): Promise<CachedPosCatalogue> {
  const catalogue = stored({
    version: POS_CATALOGUE_CACHE_VERSION,
    ...value,
  });
  const encrypted = await encryptOfflinePosCache(
    posBrowserCrypto(),
    "pos-catalogue",
    scope,
    catalogue,
  );
  const record: EncryptedPosCatalogueRecord = {
    id: catalogueId(scope),
    companyId: scope.companyId,
    branchId: scope.branchId,
    deviceId: scope.deviceId,
    cashierUserId: scope.cashierUserId,
    refreshedAt: catalogue.refreshedAt,
    ...encrypted,
    updatedAt: new Date().toISOString(),
  };
  await posDeviceDatabase().posCatalogues.put(record);
  return visible(catalogue);
}

export async function cachedPosCatalogue(
  scope: OfflineAuthorityScope,
): Promise<CachedPosCatalogue | undefined> {
  const database = posDeviceDatabase();
  const record = await database.posCatalogues.get(catalogueId(scope));
  if (!record) return undefined;
  try {
    const catalogue = stored(
      await decryptOfflinePosCache<unknown>(
        posBrowserCrypto(),
        "pos-catalogue",
        scope,
        record,
      ),
    );
    if (record.refreshedAt !== catalogue.refreshedAt)
      throw new Error("Cached POS catalogue metadata is invalid.");
    return visible(catalogue);
  } catch {
    await database.posCatalogues.delete(record.id);
    return undefined;
  }
}

export async function refreshPosCatalogue(
  scope: OfflineAuthorityScope,
): Promise<CachedPosCatalogue> {
  const response = await request<CachedPosCatalogue>(
    `/companies/${scope.companyId}/branches/${scope.branchId}/pos/catalogue`,
  );
  return cachePosCatalogue(scope, response);
}
