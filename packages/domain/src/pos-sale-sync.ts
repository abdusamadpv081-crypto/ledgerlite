export const POS_CASH_SALE_EVENT_CONTEXT = "ledgerlite:pos-cash-sale:v1";
export const POS_CASH_SALE_EVENT_SCHEMA_VERSION = 1;

export type PosSaleTaxSnapshot = Readonly<{
  id: string;
  code: string;
  name: string;
  rate: string;
}>;

export type PosCashSaleLine = Readonly<{
  productId: string;
  productName: string;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  taxTreatment: "inclusive" | "exclusive";
  taxCode: PosSaleTaxSnapshot | null;
  netAmount: string;
  taxAmount: string;
  totalAmount: string;
}>;

export type PosCashSaleEvent = Readonly<{
  schemaVersion: typeof POS_CASH_SALE_EVENT_SCHEMA_VERSION;
  eventType: "cash_sale";
  eventId: string;
  localReceiptId: string;
  localSequence: number;
  companyId: string;
  branchId: string;
  deviceId: string;
  cashierUserId: string;
  shiftId: string;
  authorityGrantId: string;
  authorityPolicyId: string;
  authorityPolicyVersion: number;
  occurredAt: string;
  currency: string;
  payment: Readonly<{ method: "cash"; amount: string }>;
  lines: readonly PosCashSaleLine[];
  totals: Readonly<{
    netAmount: string;
    taxAmount: string;
    totalAmount: string;
  }>;
}>;

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
  throw new Error("POS sale signature payload contains a non-JSON value.");
}

/**
 * Returns the exact bytes a POS device signs for a cash-sale event. The
 * context string prevents a valid signature for another device protocol from
 * being replayed as a sale signature.
 */
export function posCashSaleSignaturePayload(
  event: PosCashSaleEvent,
): Uint8Array {
  return new TextEncoder().encode(
    `${POS_CASH_SALE_EVENT_CONTEXT}:${canonicalJson(event)}`,
  );
}
