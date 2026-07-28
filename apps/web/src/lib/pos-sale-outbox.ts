import {
  POS_CASH_SALE_EVENT_SCHEMA_VERSION,
  posCashSaleSignaturePayload,
  type PosCashSaleEvent,
  type PosCashSaleLine,
} from "@ledgerlite/domain";
import { request } from "./api";
import {
  decryptOfflinePosCache,
  encryptOfflinePosCache,
  type CachedOfflineAuthority,
  type OfflineAuthorityScope,
} from "./pos-offline-authority";
import { type CachedCashShift } from "./pos-cash-shift";
import {
  type LocalPosDevice,
  POS_SALE_OUTBOX_VERSION,
  type EncryptedPosSaleOutboxRecord,
  type PosSaleSequenceRecord,
  posBrowserCrypto,
  posDeviceDatabase,
  signDevicePayload,
} from "./pos-device";

const decimalPlaces = 6;
const decimalScale = 10n ** BigInt(decimalPlaces);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decimal = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;

export type PosCatalogueProduct = Readonly<{
  id: string;
  name: string;
  sku: string | null;
  unitPrice: string;
  currency: string;
  taxTreatment: "inclusive" | "exclusive";
  taxCode: Readonly<{
    id: string;
    code: string;
    name: string;
    rate: string;
  }> | null;
}>;

export type LocalSaleLine = PosCashSaleLine;
export type LocalSaleAcknowledgement = Readonly<{
  acknowledgedAt: string;
  journalEntryId?: string;
  rejectionCode?: string;
  rejectionMessage?: string;
  saleId?: string;
  stockException?: boolean;
}>;
export type LocalSaleStatus =
  "pending_sync" | "syncing" | "synced" | "rejected";
export type LocalCashSaleDraft = PosCashSaleEvent &
  Readonly<{
    version: typeof POS_SALE_OUTBOX_VERSION;
    status: "pending_sync";
  }>;
export type LocalCashSaleEvent = PosCashSaleEvent &
  Readonly<{
    version: typeof POS_SALE_OUTBOX_VERSION;
    status: LocalSaleStatus;
    deviceSignature: string;
    acknowledgement?: LocalSaleAcknowledgement;
  }>;

export type LocalSaleContext = Readonly<{
  scope: OfflineAuthorityScope;
  authority: CachedOfflineAuthority;
  cashShift: CachedCashShift;
  localSessionExpiresAt: string;
}>;

export type LocalCashSaleInput = Readonly<{
  context: LocalSaleContext;
  device?: LocalPosDevice;
  products: readonly PosCatalogueProduct[];
  lines: readonly Readonly<{ productId: string; quantity: number }>[];
  localSequence?: number;
  eventId?: string;
  localReceiptId?: string;
  occurredAt?: string;
}>;

type StoredSale = LocalCashSaleEvent;

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function eventForSignature(
  sale: LocalCashSaleDraft | LocalCashSaleEvent,
): PosCashSaleEvent {
  const {
    acknowledgement: _acknowledgement,
    deviceSignature: _deviceSignature,
    status: _status,
    version: _version,
    ...event
  } = sale as LocalCashSaleEvent;
  return event;
}

function moneyUnits(value: string): bigint {
  if (!decimal.test(value)) throw new Error("A POS sale amount is invalid.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * decimalScale + BigInt(fraction.padEnd(6, "0"));
}

function money(value: bigint): string {
  if (value < 0n) throw new Error("A POS sale amount is invalid.");
  const whole = value / decimalScale;
  const fraction = (value % decimalScale)
    .toString()
    .padStart(decimalPlaces, "0");
  return `${whole}.${fraction}`;
}

function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n)
    throw new Error("A POS sale amount is invalid.");
  return (numerator + denominator / 2n) / denominator;
}

function timestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value)))
    throw new Error("A POS sale timestamp is invalid.");
  return value;
}

function identifier(value: string, message: string): string {
  if (!uuid.test(value)) throw new Error(message);
  return value;
}

function positiveInteger(value: number, message: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 999_999)
    throw new Error(message);
  return value;
}
function localSequence(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(message);
  return value;
}

function currency(value: string): string {
  if (!/^[A-Z]{3}$/.test(value))
    throw new Error("POS sale currency is invalid.");
  return value;
}

function saleId(scope: OfflineAuthorityScope, eventId: string): string {
  return `${scope.companyId}:${scope.branchId}:${scope.deviceId}:${scope.cashierUserId}:${eventId}`;
}

function saleSequenceId(scope: OfflineAuthorityScope): string {
  return `${scope.companyId}:${scope.branchId}:${scope.deviceId}:${scope.cashierUserId}`;
}

function scopeMatches(
  scope: OfflineAuthorityScope,
  sale: Pick<
    LocalCashSaleEvent,
    "companyId" | "branchId" | "deviceId" | "cashierUserId"
  >,
): boolean {
  return (
    sale.companyId === scope.companyId &&
    sale.branchId === scope.branchId &&
    sale.deviceId === scope.deviceId &&
    sale.cashierUserId === scope.cashierUserId
  );
}

function line(product: PosCatalogueProduct, quantity: number): LocalSaleLine {
  const parsedQuantity = positiveInteger(
    quantity,
    "POS sale quantity must be a whole number between 1 and 999999.",
  );
  const unitPrice = moneyUnits(product.unitPrice);
  const lineAmount = unitPrice * BigInt(parsedQuantity);
  const rate = product.taxCode ? moneyUnits(product.taxCode.rate) : 0n;
  const taxAmount =
    product.taxTreatment === "inclusive"
      ? roundedDivide(lineAmount * rate, decimalScale + rate)
      : roundedDivide(lineAmount * rate, decimalScale);
  const netAmount =
    product.taxTreatment === "inclusive" ? lineAmount - taxAmount : lineAmount;
  const totalAmount =
    product.taxTreatment === "inclusive" ? lineAmount : lineAmount + taxAmount;
  return {
    productId: identifier(product.id, "POS sale product ID is invalid."),
    productName: product.name.trim(),
    sku: product.sku,
    quantity: parsedQuantity,
    unitPrice: money(unitPrice),
    taxTreatment: product.taxTreatment,
    taxCode: product.taxCode,
    netAmount: money(netAmount),
    taxAmount: money(taxAmount),
    totalAmount: money(totalAmount),
  };
}

function totals(lines: readonly LocalSaleLine[]) {
  const result = lines.reduce(
    (current, item) => ({
      netAmount: current.netAmount + moneyUnits(item.netAmount),
      taxAmount: current.taxAmount + moneyUnits(item.taxAmount),
      totalAmount: current.totalAmount + moneyUnits(item.totalAmount),
    }),
    { netAmount: 0n, taxAmount: 0n, totalAmount: 0n },
  );
  return {
    netAmount: money(result.netAmount),
    taxAmount: money(result.taxAmount),
    totalAmount: money(result.totalAmount),
  } as const;
}

function assertContext(context: LocalSaleContext, occurredAt: string): void {
  const { authority, cashShift, localSessionExpiresAt, scope } = context;
  if (!scopeMatches(scope, authority))
    throw new Error("Offline authority does not match this POS device.");
  if (!authority.capabilities.includes("pos.sale.create"))
    throw new Error("Offline authority does not allow local sales.");
  if (Date.parse(authority.expiresAt) <= Date.parse(occurredAt))
    throw new Error("Offline authority has expired. Connect to refresh it.");
  if (Date.parse(localSessionExpiresAt) <= Date.parse(occurredAt))
    throw new Error(
      "Cashier PIN unlock has expired. Unlock it before the sale.",
    );
  if (
    cashShift.status !== "open" ||
    cashShift.branchId !== scope.branchId ||
    cashShift.deviceId !== scope.deviceId ||
    cashShift.cashierUserId !== scope.cashierUserId
  )
    throw new Error(
      "An open cash shift on this device is required for a sale.",
    );
  if (
    cashShift.policyId !== authority.policyId ||
    cashShift.policyVersion !== authority.policyVersion
  )
    throw new Error("Cash shift policy does not match offline authority.");
}

export function createLocalCashSale(
  input: LocalCashSaleInput,
): LocalCashSaleDraft {
  const occurredAt = timestamp(input.occurredAt ?? new Date().toISOString());
  assertContext(input.context, occurredAt);
  if (input.lines.length === 0)
    throw new Error("Add at least one product before saving a local sale.");
  const products = new Map(
    input.products.map((product) => [product.id, product]),
  );
  const lines = input.lines.map((saleLine) => {
    const product = products.get(saleLine.productId);
    if (!product)
      throw new Error(
        "A selected product is no longer in the cached POS catalogue.",
      );
    if (product.currency !== input.context.cashShift.currencyCode)
      throw new Error("Product currency does not match the open cash shift.");
    return line(product, saleLine.quantity);
  });
  const saleTotals = totals(lines);
  const eventId = identifier(
    input.eventId ?? posBrowserCrypto().randomUUID(),
    "Local sale event ID is invalid.",
  );
  const localReceiptId = identifier(
    input.localReceiptId ?? posBrowserCrypto().randomUUID(),
    "Local sale receipt ID is invalid.",
  );
  if (eventId === localReceiptId)
    throw new Error("Local sale event and receipt IDs must be distinct.");
  return {
    version: POS_SALE_OUTBOX_VERSION,
    schemaVersion: POS_CASH_SALE_EVENT_SCHEMA_VERSION,
    eventType: "cash_sale",
    eventId,
    localReceiptId,
    localSequence: localSequence(
      input.localSequence ?? 1,
      "Local sale sequence is invalid.",
    ),
    status: "pending_sync",
    companyId: input.context.scope.companyId,
    branchId: input.context.scope.branchId,
    deviceId: input.context.scope.deviceId,
    cashierUserId: input.context.scope.cashierUserId,
    shiftId: identifier(
      input.context.cashShift.id,
      "Cash shift ID is invalid.",
    ),
    authorityGrantId: identifier(
      input.context.authority.grantId,
      "Offline authority grant ID is invalid.",
    ),
    authorityPolicyId: identifier(
      input.context.authority.policyId,
      "Offline authority policy ID is invalid.",
    ),
    authorityPolicyVersion: positiveInteger(
      input.context.authority.policyVersion,
      "Offline authority policy version is invalid.",
    ),
    occurredAt,
    currency: currency(input.context.cashShift.currencyCode),
    payment: { method: "cash", amount: saleTotals.totalAmount },
    lines,
    totals: saleTotals,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Encrypted local sale is invalid.");
  return value as Record<string, unknown>;
}

function storedSale(value: unknown, scope: OfflineAuthorityScope): StoredSale {
  const sale = object(value) as Partial<LocalCashSaleEvent>;
  if (
    sale.version !== POS_SALE_OUTBOX_VERSION ||
    sale.schemaVersion !== POS_CASH_SALE_EVENT_SCHEMA_VERSION ||
    sale.eventType !== "cash_sale" ||
    !["pending_sync", "syncing", "synced", "rejected"].includes(
      sale.status as string,
    ) ||
    typeof sale.eventId !== "string" ||
    typeof sale.localReceiptId !== "string" ||
    typeof sale.localSequence !== "number" ||
    typeof sale.deviceSignature !== "string" ||
    !scopeMatches(scope, sale as LocalCashSaleEvent) ||
    typeof sale.shiftId !== "string" ||
    typeof sale.authorityGrantId !== "string" ||
    typeof sale.authorityPolicyId !== "string" ||
    typeof sale.authorityPolicyVersion !== "number" ||
    typeof sale.occurredAt !== "string" ||
    typeof sale.currency !== "string" ||
    !Array.isArray(sale.lines) ||
    sale.lines.length === 0 ||
    !sale.totals ||
    !sale.payment
  )
    throw new Error("Encrypted local sale is invalid.");
  identifier(sale.eventId, "Encrypted local sale is invalid.");
  identifier(sale.localReceiptId, "Encrypted local sale is invalid.");
  localSequence(sale.localSequence, "Encrypted local sale is invalid.");
  if (!/^[A-Za-z0-9_-]{86}$/.test(sale.deviceSignature))
    throw new Error("Encrypted local sale is invalid.");
  if (sale.eventId === sale.localReceiptId)
    throw new Error("Encrypted local sale is invalid.");
  timestamp(sale.occurredAt);
  currency(sale.currency);
  positiveInteger(
    sale.authorityPolicyVersion,
    "Encrypted local sale is invalid.",
  );
  const checkedLines = sale.lines.map((item) => {
    const candidate = object(item);
    if (
      typeof candidate.productId !== "string" ||
      typeof candidate.productName !== "string" ||
      !(candidate.sku === null || typeof candidate.sku === "string") ||
      typeof candidate.quantity !== "number" ||
      !["inclusive", "exclusive"].includes(candidate.taxTreatment as string) ||
      !("taxCode" in candidate)
    )
      throw new Error("Encrypted local sale is invalid.");
    const taxCode = candidate.taxCode;
    if (taxCode !== null) {
      const tax = object(taxCode);
      if (
        typeof tax.id !== "string" ||
        typeof tax.code !== "string" ||
        typeof tax.name !== "string" ||
        typeof tax.rate !== "string"
      )
        throw new Error("Encrypted local sale is invalid.");
      moneyUnits(tax.rate);
    }
    identifier(candidate.productId, "Encrypted local sale is invalid.");
    positiveInteger(candidate.quantity, "Encrypted local sale is invalid.");
    const unitPrice = moneyUnits(String(candidate.unitPrice));
    const netAmount = moneyUnits(String(candidate.netAmount));
    const taxAmount = moneyUnits(String(candidate.taxAmount));
    const totalAmount = moneyUnits(String(candidate.totalAmount));
    if (unitPrice <= 0n || netAmount + taxAmount !== totalAmount)
      throw new Error("Encrypted local sale is invalid.");
    return {
      productId: candidate.productId,
      productName: candidate.productName,
      sku: candidate.sku as string | null,
      quantity: candidate.quantity,
      unitPrice: money(unitPrice),
      taxTreatment: candidate.taxTreatment as "inclusive" | "exclusive",
      taxCode: candidate.taxCode as PosCatalogueProduct["taxCode"],
      netAmount: money(netAmount),
      taxAmount: money(taxAmount),
      totalAmount: money(totalAmount),
    } satisfies LocalSaleLine;
  });
  const expectedTotals = totals(checkedLines);
  const totalsCandidate = object(sale.totals);
  const payment = object(sale.payment);
  if (
    totalsCandidate.netAmount !== expectedTotals.netAmount ||
    totalsCandidate.taxAmount !== expectedTotals.taxAmount ||
    totalsCandidate.totalAmount !== expectedTotals.totalAmount ||
    payment.method !== "cash" ||
    payment.amount !== expectedTotals.totalAmount
  )
    throw new Error("Encrypted local sale is invalid.");
  let acknowledgement: LocalSaleAcknowledgement | undefined;
  if (sale.acknowledgement !== undefined) {
    const candidate = object(sale.acknowledgement);
    if (
      typeof candidate.acknowledgedAt !== "string" ||
      (candidate.journalEntryId !== undefined &&
        typeof candidate.journalEntryId !== "string") ||
      (candidate.rejectionCode !== undefined &&
        typeof candidate.rejectionCode !== "string") ||
      (candidate.rejectionMessage !== undefined &&
        typeof candidate.rejectionMessage !== "string") ||
      (candidate.saleId !== undefined &&
        typeof candidate.saleId !== "string") ||
      (candidate.stockException !== undefined &&
        typeof candidate.stockException !== "boolean")
    )
      throw new Error("Encrypted local sale is invalid.");
    timestamp(candidate.acknowledgedAt);
    acknowledgement = {
      acknowledgedAt: candidate.acknowledgedAt,
      ...(candidate.journalEntryId === undefined
        ? {}
        : { journalEntryId: candidate.journalEntryId }),
      ...(candidate.rejectionCode === undefined
        ? {}
        : { rejectionCode: candidate.rejectionCode }),
      ...(candidate.rejectionMessage === undefined
        ? {}
        : { rejectionMessage: candidate.rejectionMessage }),
      ...(candidate.saleId === undefined ? {} : { saleId: candidate.saleId }),
      ...(candidate.stockException === undefined
        ? {}
        : { stockException: candidate.stockException }),
    };
  }
  if (
    (sale.status === "synced" || sale.status === "rejected") &&
    acknowledgement === undefined
  )
    throw new Error("Encrypted local sale is invalid.");
  return {
    version: POS_SALE_OUTBOX_VERSION,
    schemaVersion: POS_CASH_SALE_EVENT_SCHEMA_VERSION,
    eventType: "cash_sale",
    eventId: sale.eventId,
    localReceiptId: sale.localReceiptId,
    localSequence: sale.localSequence,
    status: sale.status as LocalSaleStatus,
    companyId: scope.companyId,
    branchId: scope.branchId,
    deviceId: scope.deviceId,
    cashierUserId: scope.cashierUserId,
    shiftId: identifier(sale.shiftId, "Encrypted local sale is invalid."),
    authorityGrantId: identifier(
      sale.authorityGrantId,
      "Encrypted local sale is invalid.",
    ),
    authorityPolicyId: identifier(
      sale.authorityPolicyId,
      "Encrypted local sale is invalid.",
    ),
    authorityPolicyVersion: positiveInteger(
      sale.authorityPolicyVersion,
      "Encrypted local sale is invalid.",
    ),
    occurredAt: sale.occurredAt,
    currency: sale.currency,
    payment: { method: "cash", amount: expectedTotals.totalAmount },
    lines: checkedLines,
    totals: expectedTotals,
    deviceSignature: sale.deviceSignature,
    ...(acknowledgement === undefined ? {} : { acknowledgement }),
  };
}

export async function enqueueLocalCashSale(
  input: LocalCashSaleInput,
): Promise<LocalCashSaleEvent> {
  const scope = input.context.scope;
  const device = input.device;
  if (
    !device ||
    device.state !== "registered" ||
    device.deviceId !== scope.deviceId ||
    device.companyId !== scope.companyId ||
    device.branchId !== scope.branchId
  )
    throw new Error(
      "This registered browser device is required to sign a local cash sale.",
    );
  const sequence = await nextLocalSequence(scope);
  const draft = createLocalCashSale({ ...input, localSequence: sequence });
  const signature = await signDevicePayload(
    device,
    posCashSaleSignaturePayload(eventForSignature(draft)),
  );
  const sale: LocalCashSaleEvent = {
    ...draft,
    deviceSignature: base64Url(new Uint8Array(signature)),
  };
  try {
    await storeSale(scope, sale, false);
  } catch (error) {
    if (error instanceof Error && error.name === "ConstraintError")
      throw new Error(
        "This local sale is already queued for synchronization.",
        { cause: error },
      );
    throw error;
  }
  return sale;
}

async function nextLocalSequence(
  scope: OfflineAuthorityScope,
): Promise<number> {
  const database = posDeviceDatabase();
  return database.transaction(
    "rw",
    database.saleOutbox,
    database.saleSequences,
    async () => {
      const id = saleSequenceId(scope);
      const existing = await database.saleSequences.get(id);
      const firstSequence = existing
        ? existing.nextLocalSequence
        : await firstAvailableSequence(database.saleOutbox, scope);
      if (!Number.isSafeInteger(firstSequence) || firstSequence < 1)
        throw new Error(
          "This POS device has exhausted its local sale sequence.",
        );
      if (firstSequence >= Number.MAX_SAFE_INTEGER)
        throw new Error(
          "This POS device has exhausted its local sale sequence.",
        );
      const counter: PosSaleSequenceRecord = {
        id,
        companyId: scope.companyId,
        branchId: scope.branchId,
        deviceId: scope.deviceId,
        cashierUserId: scope.cashierUserId,
        nextLocalSequence: firstSequence + 1,
        updatedAt: new Date().toISOString(),
      };
      await database.saleSequences.put(counter);
      return firstSequence;
    },
  );
}

async function firstAvailableSequence(
  saleOutbox: ReturnType<typeof posDeviceDatabase>["saleOutbox"],
  scope: OfflineAuthorityScope,
): Promise<number> {
  const records = await saleOutbox
    .filter(
      (record) =>
        record.companyId === scope.companyId &&
        record.branchId === scope.branchId &&
        record.deviceId === scope.deviceId &&
        record.cashierUserId === scope.cashierUserId,
    )
    .toArray();
  const highest = records.reduce(
    (current, record) =>
      Number.isSafeInteger(record.localSequence)
        ? Math.max(current, record.localSequence)
        : current,
    0,
  );
  if (highest >= Number.MAX_SAFE_INTEGER)
    throw new Error("This POS device has exhausted its local sale sequence.");
  return highest + 1;
}

async function storeSale(
  scope: OfflineAuthorityScope,
  sale: LocalCashSaleEvent,
  replace: boolean,
): Promise<void> {
  const encrypted = await encryptOfflinePosCache(
    posBrowserCrypto(),
    "sale-outbox",
    scope,
    sale,
  );
  const record: EncryptedPosSaleOutboxRecord = {
    id: saleId(scope, sale.eventId),
    companyId: scope.companyId,
    branchId: scope.branchId,
    deviceId: scope.deviceId,
    cashierUserId: scope.cashierUserId,
    shiftId: sale.shiftId,
    authorityGrantId: sale.authorityGrantId,
    localSequence: sale.localSequence,
    status: sale.status,
    occurredAt: sale.occurredAt,
    ...encrypted,
    updatedAt: new Date().toISOString(),
  };
  if (replace) await posDeviceDatabase().saleOutbox.put(record);
  else await posDeviceDatabase().saleOutbox.add(record);
}

export async function localCashSales(
  scope: OfflineAuthorityScope,
): Promise<readonly LocalCashSaleEvent[]> {
  const database = posDeviceDatabase();
  const records = await database.saleOutbox
    .filter(
      (record) =>
        record.companyId === scope.companyId &&
        record.branchId === scope.branchId &&
        record.deviceId === scope.deviceId &&
        record.cashierUserId === scope.cashierUserId,
    )
    .toArray();
  const sales: LocalCashSaleEvent[] = [];
  for (const record of records) {
    // Pre-release v1 records have no signed protocol payload. Leave their
    // encrypted evidence untouched instead of silently discarding it.
    if (!Number.isSafeInteger(record.localSequence)) continue;
    try {
      let sale = storedSale(
        await decryptOfflinePosCache<unknown>(
          posBrowserCrypto(),
          "sale-outbox",
          scope,
          record,
        ),
        scope,
      );
      if (
        record.id !== saleId(scope, sale.eventId) ||
        record.shiftId !== sale.shiftId ||
        record.authorityGrantId !== sale.authorityGrantId ||
        record.localSequence !== sale.localSequence ||
        record.status !== sale.status ||
        record.occurredAt !== sale.occurredAt
      )
        throw new Error("Encrypted local sale metadata is invalid.");
      if (sale.status === "syncing") {
        sale = { ...sale, status: "pending_sync" };
        await storeSale(scope, sale, true);
      }
      sales.push(sale);
    } catch {
      await database.saleOutbox.delete(record.id);
    }
  }
  return sales.sort(
    (left, right) =>
      left.localSequence - right.localSequence ||
      left.occurredAt.localeCompare(right.occurredAt),
  );
}

export async function pendingLocalCashSales(
  scope: OfflineAuthorityScope,
): Promise<readonly LocalCashSaleEvent[]> {
  const sales = await localCashSales(scope);
  return sales.filter(
    (sale) => sale.status === "pending_sync" || sale.status === "rejected",
  );
}

type SaleSyncApiResponse = Readonly<{
  data:
    | Readonly<{
        acknowledgedAt: string;
        eventId: string;
        journalEntryId: string;
        localReceiptId: string;
        saleId: string;
        status:
          "accepted" | "duplicate_accepted" | "accepted_with_stock_exception";
        stockException: boolean;
      }>
    | Readonly<{
        acknowledgedAt: string;
        eventId: string;
        rejectionCode: string;
        rejectionMessage: string;
        status: "rejected";
      }>;
}>;
export type SaleSyncSummary = Readonly<{
  rejected: number;
  synced: number;
  waiting: number;
}>;

export async function synchronizeLocalCashSales(input: {
  device: LocalPosDevice;
  scope: OfflineAuthorityScope;
}): Promise<SaleSyncSummary> {
  const { device, scope } = input;
  if (
    device.state !== "registered" ||
    device.deviceId !== scope.deviceId ||
    device.companyId !== scope.companyId ||
    device.branchId !== scope.branchId
  )
    throw new Error("This browser is not the registered POS device for sync.");
  const sales = await localCashSales(scope);
  let rejected = 0;
  let synced = 0;
  let waiting = 0;
  for (const current of sales) {
    if (current.status === "synced") continue;
    const syncing: LocalCashSaleEvent = { ...current, status: "syncing" };
    await storeSale(scope, syncing, true);
    try {
      const response = await request<SaleSyncApiResponse>(
        `/companies/${scope.companyId}/branches/${scope.branchId}/pos/sales/sync`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...eventForSignature(current),
            deviceSignature: current.deviceSignature,
          }),
        },
      );
      const result = response.data;
      if (
        result.eventId !== current.eventId ||
        ("localReceiptId" in result &&
          result.localReceiptId !== current.localReceiptId)
      )
        throw new Error("The server acknowledgement does not match this sale.");
      if (result.status === "rejected") {
        await storeSale(
          scope,
          {
            ...current,
            status: "rejected",
            acknowledgement: {
              acknowledgedAt: result.acknowledgedAt,
              rejectionCode: result.rejectionCode,
              rejectionMessage: result.rejectionMessage,
            },
          },
          true,
        );
        rejected += 1;
      } else {
        await storeSale(
          scope,
          {
            ...current,
            status: "synced",
            acknowledgement: {
              acknowledgedAt: result.acknowledgedAt,
              journalEntryId: result.journalEntryId,
              saleId: result.saleId,
              stockException: result.stockException,
            },
          },
          true,
        );
        synced += 1;
      }
    } catch {
      await storeSale(scope, { ...current, status: "pending_sync" }, true);
      waiting += 1;
    }
  }
  return { rejected, synced, waiting };
}
