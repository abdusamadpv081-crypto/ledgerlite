import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cachePosCatalogue, cachedPosCatalogue } from "./pos-catalogue";
import {
  createLocalCashSale,
  enqueueLocalCashSale,
  pendingLocalCashSales,
  type LocalCashSaleInput,
} from "./pos-sale-outbox";
import { posDeviceDatabase } from "./pos-device";

const scope = {
  companyId: "c22ff1c3-253f-4457-bcc5-3098d827de20",
  branchId: "d556b3b8-fdbc-4ea6-9c0b-531dd8e704ed",
  deviceId: "f0fd3509-4724-4b95-86c8-d2a4a6f0a204",
  cashierUserId: "dcebc785-a5d1-474b-a5d1-2b27d04e6668",
} as const;

const products = [
  {
    id: "3e3e9195-2cb8-48c5-8a9d-6c629b15bb90",
    name: "Arabic coffee",
    sku: "COFFEE-01",
    unitPrice: "10.000000",
    currency: "AED",
    taxTreatment: "inclusive" as const,
    taxCode: {
      id: "260a3b52-7ef4-4b5d-b96b-763e280c1a50",
      code: "VAT5",
      name: "VAT 5%",
      rate: "0.050000",
    },
  },
  {
    id: "987c3a51-6a0a-42fc-b2f2-bb2c2e14b410",
    name: "Paper bag",
    sku: null,
    unitPrice: "2.000000",
    currency: "AED",
    taxTreatment: "exclusive" as const,
    taxCode: null,
  },
] as const;

function saleInput(
  overrides: Partial<LocalCashSaleInput> = {},
): LocalCashSaleInput {
  return {
    context: {
      scope,
      authority: {
        ...scope,
        grantId: "6ef30a4b-d0d6-47bf-98ed-a137fc8d4110",
        issuedAt: "2026-07-26T10:00:00.000Z",
        expiresAt: "2030-07-26T10:00:00.000Z",
        policyId: "a6e1ef38-841a-4e95-8cf5-ea04df5b6ef1",
        policyVersion: 1,
        capabilities: ["pos.shift.operate", "pos.sale.create"],
        token: "signed-test-authority",
      },
      cashShift: {
        id: "b3d30ef2-7ec5-4570-9387-6fe312b68001",
        branchId: scope.branchId,
        deviceId: scope.deviceId,
        cashierUserId: scope.cashierUserId,
        status: "open",
        currencyCode: "AED",
        openingFloat: "100.00",
        policyId: "a6e1ef38-841a-4e95-8cf5-ea04df5b6ef1",
        policyVersion: 1,
        openedAt: "2026-07-26T10:00:00.000Z",
      },
      localSessionExpiresAt: "2030-07-26T11:00:00.000Z",
    },
    products,
    lines: [
      { productId: products[0].id, quantity: 2 },
      { productId: products[1].id, quantity: 1 },
    ],
    eventId: "995edb99-1a5f-43c9-aac3-bcc1fd281111",
    localReceiptId: "e341d2d6-5a73-4f27-9bc4-7fc329408112",
    occurredAt: "2026-07-26T10:30:00.000Z",
    ...overrides,
  };
}

beforeAll(() => {
  vi.stubGlobal("window", {
    crypto: webcrypto,
    isSecureContext: true,
  });
});

beforeEach(async () => {
  const database = posDeviceDatabase();
  await Promise.all([
    database.cacheKeys.clear(),
    database.posCatalogues.clear(),
    database.saleOutbox.clear(),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("local POS sale outbox", () => {
  it("snapshots cash-sale pricing and VAT using exact decimal arithmetic", () => {
    const sale = createLocalCashSale(saleInput());

    expect(sale).toMatchObject({
      status: "pending_sync",
      payment: { method: "cash", amount: "22.000000" },
      totals: {
        netAmount: "21.047619",
        taxAmount: "0.952381",
        totalAmount: "22.000000",
      },
    });
    expect(sale.lines[0]).toMatchObject({
      productName: "Arabic coffee",
      quantity: 2,
      netAmount: "19.047619",
      taxAmount: "0.952381",
      totalAmount: "20.000000",
    });
  });

  it("persists an encrypted immutable event across a database reopen", async () => {
    const queued = await enqueueLocalCashSale(saleInput());
    const database = posDeviceDatabase();
    const raw = await database.saleOutbox.get(
      `${scope.companyId}:${scope.branchId}:${scope.deviceId}:${scope.cashierUserId}:${queued.eventId}`,
    );

    expect(raw).toMatchObject({ status: "pending_sync" });
    expect(raw).not.toHaveProperty("eventId");
    expect(raw?.encryptedPayload).toBeInstanceOf(ArrayBuffer);
    database.close();
    await database.open();

    await expect(pendingLocalCashSales(scope)).resolves.toEqual([queued]);
    await expect(enqueueLocalCashSale(saleInput())).rejects.toThrow(
      "already queued",
    );
  });

  it("removes a tampered local sale and keeps the cached catalogue encrypted", async () => {
    const queued = await enqueueLocalCashSale(saleInput());
    const database = posDeviceDatabase();
    const raw = await database.saleOutbox.get(
      `${scope.companyId}:${scope.branchId}:${scope.deviceId}:${scope.cashierUserId}:${queued.eventId}`,
    );
    if (!raw) throw new Error("Test sale was not stored.");
    const tampered = new Uint8Array(raw.encryptedPayload.slice(0));
    tampered[0] ^= 1;
    await database.saleOutbox.update(raw.id, {
      encryptedPayload: tampered.buffer,
    });
    await cachePosCatalogue(scope, {
      products,
      refreshedAt: "2026-07-26T10:00:00.000Z",
    });

    await expect(pendingLocalCashSales(scope)).resolves.toEqual([]);
    await expect(cachedPosCatalogue(scope)).resolves.toEqual({
      products,
      refreshedAt: "2026-07-26T10:00:00.000Z",
    });
    const catalogueRecord = await database.posCatalogues.get(
      `${scope.companyId}:${scope.branchId}:${scope.deviceId}:${scope.cashierUserId}`,
    );
    expect(catalogueRecord?.encryptedPayload).toBeInstanceOf(ArrayBuffer);
  });
});
