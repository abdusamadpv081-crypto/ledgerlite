import { describe, expect, it } from "vitest";
import {
  POS_CASH_SALE_EVENT_CONTEXT,
  POS_CASH_SALE_EVENT_SCHEMA_VERSION,
  posCashSaleSignaturePayload,
  type PosCashSaleEvent,
} from "../src/pos-sale-sync.js";

const event: PosCashSaleEvent = {
  schemaVersion: POS_CASH_SALE_EVENT_SCHEMA_VERSION,
  eventType: "cash_sale",
  eventId: "45a0cf3b-6a76-4a00-8d49-76568cb4193d",
  localReceiptId: "a77a2027-e9a7-4440-88e0-954c8a9b70bc",
  localSequence: 7,
  companyId: "a3eed5c4-2bd8-4a93-b949-b7c51c645db7",
  branchId: "a6d074ba-88f9-4fc4-8c9a-f6b6e1a85081",
  deviceId: "f892b514-64de-48aa-a85d-67b623dbadc4",
  cashierUserId: "64ab7bea-ae9e-4a65-9f65-f6b45ec5c2e8",
  shiftId: "75556584-5e2a-4f5b-8f77-0745a89483c3",
  authorityGrantId: "f3af2cef-0ca3-450e-a1a5-7438b23fec21",
  authorityPolicyId: "7759b7e4-8d92-4241-81cd-f5c55790a100",
  authorityPolicyVersion: 2,
  occurredAt: "2026-07-28T09:30:00.000Z",
  currency: "AED",
  payment: { method: "cash", amount: "105.000000" },
  lines: [
    {
      productId: "78b2f2ea-ef49-4c1e-9bbf-0667489c8a30",
      productName: "Sample product",
      sku: "SAMPLE-1",
      quantity: 1,
      unitPrice: "100.000000",
      taxTreatment: "exclusive",
      taxCode: {
        id: "12a0c9f6-c5f7-43bd-9d52-65e4db9cf745",
        code: "VAT5",
        name: "UAE VAT",
        rate: "0.050000",
      },
      netAmount: "100.000000",
      taxAmount: "5.000000",
      totalAmount: "105.000000",
    },
  ],
  totals: {
    netAmount: "100.000000",
    taxAmount: "5.000000",
    totalAmount: "105.000000",
  },
};

describe("POS cash-sale signature payload", () => {
  it("is deterministic and bound to the cash-sale protocol context", () => {
    const payload = new TextDecoder().decode(
      posCashSaleSignaturePayload(event),
    );

    expect(payload).toContain(`${POS_CASH_SALE_EVENT_CONTEXT}:`);
    expect(payload).toContain('"eventType":"cash_sale"');
    expect(posCashSaleSignaturePayload({ ...event })).toEqual(
      posCashSaleSignaturePayload(event),
    );
  });

  it("changes when a financially material field changes", () => {
    expect(
      posCashSaleSignaturePayload({
        ...event,
        totals: { ...event.totals, totalAmount: "106.000000" },
      }),
    ).not.toEqual(posCashSaleSignaturePayload(event));
  });
});
