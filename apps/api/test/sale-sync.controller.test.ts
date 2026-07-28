import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SaleSyncController } from "../src/pos/sale-sync.controller.js";
import type { SaleSyncService } from "../src/pos/sale-sync.service.js";

const companyId = "7bd730dc-e896-4a35-82a0-c4b3c3aab59c";
const branchId = "21770e30-b58a-4e7e-85cf-2e7b227d5b84";
const deviceId = "2862ce5c-8e12-4d1f-bf50-32d1f75a5c8f";
const cashierUserId = "9493aed6-569b-4d5a-ab49-452fd7c3fe1d";
const shiftId = "36f46bab-6a23-4df1-a3a2-b97f7688f67a";
const grantId = "e4156cec-8d67-4d8b-a4a2-0c3b70fe43cc";
const policyId = "d3e13eb1-39b4-4f75-bb2f-6e1cae44a9cc";
const productId = "8b8af2ec-bfef-47d1-97b8-6c9e234cea51";
const taxCodeId = "6ccce79a-0538-469f-8a10-d0e7fb0dd85f";

function saleBody() {
  return {
    schemaVersion: 1,
    eventType: "cash_sale",
    eventId: "e7efcfbb-3656-4a7d-bc54-2b0a8b5fac1e",
    localReceiptId: "3874cb20-cc31-446b-9c5e-c9672d0c2c71",
    localSequence: 1,
    companyId,
    branchId,
    deviceId,
    cashierUserId,
    shiftId,
    authorityGrantId: grantId,
    authorityPolicyId: policyId,
    authorityPolicyVersion: 1,
    occurredAt: "2026-07-28T10:00:00.000Z",
    currency: "AED",
    payment: { method: "cash", amount: "105.000000" },
    lines: [
      {
        productId,
        productName: "Validated product",
        sku: "VALID-1",
        quantity: 1,
        unitPrice: "100.000000",
        taxTreatment: "exclusive",
        taxCode: {
          id: taxCodeId,
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
    deviceSignature: "A".repeat(86),
  };
}

describe("SaleSyncController", () => {
  it("validates the exact cash-sale schema and forwards only the route scope", async () => {
    const sync = vi.fn().mockResolvedValue({ data: { status: "accepted" } });
    const controller = new SaleSyncController({
      sync,
    } as unknown as SaleSyncService);

    await expect(
      controller.sync(companyId, branchId, saleBody(), {
        userId: cashierUserId,
      }),
    ).resolves.toEqual({ data: { status: "accepted" } });
    expect(sync).toHaveBeenCalledWith(
      { actorUserId: cashierUserId, companyId },
      branchId,
      saleBody(),
    );
    expect(() =>
      controller.sync(
        companyId,
        branchId,
        { ...saleBody(), currency: "aed" },
        {
          userId: cashierUserId,
        },
      ),
    ).toThrow(BadRequestException);
  });
});
