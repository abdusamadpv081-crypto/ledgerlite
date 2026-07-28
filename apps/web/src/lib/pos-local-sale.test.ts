import "fake-indexeddb/auto";

import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachePosCatalogue, cachedPosCatalogue } from "./pos-catalogue";
import {
  createLocalCashSale,
  enqueueLocalCashSale,
  localCashSales,
  pendingLocalCashSales,
  synchronizeLocalCashSales,
  type LocalCashSaleInput,
} from "./pos-sale-outbox";
import { posDeviceDatabase, type LocalPosDevice } from "./pos-device";

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
let device: LocalPosDevice;

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
    device,
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

beforeEach(async () => {
  vi.stubGlobal("window", {
    crypto: webcrypto,
    isSecureContext: true,
  });
  const keys = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  device = {
    id: `${scope.companyId}:${scope.branchId}`,
    companyId: scope.companyId,
    branchId: scope.branchId,
    displayName: "Test POS",
    publicKeyJwk: {
      alg: "ES256",
      crv: "P-256",
      ext: true,
      key_ops: ["verify"],
      kty: "EC",
      x: "test-x",
      y: "test-y",
    },
    privateSigningKey: keys.privateKey as unknown as CryptoKey,
    registrationIdempotencyKey: "72f103ad-bc06-4cbe-80b4-4e5efebd6341",
    state: "registered",
    deviceId: scope.deviceId,
    publicKeyFingerprint: "test-fingerprint",
    updatedAt: "2026-07-26T10:00:00.000Z",
  };
  const database = posDeviceDatabase();
  await Promise.all([
    database.cacheKeys.clear(),
    database.posCatalogues.clear(),
    database.saleOutbox.clear(),
    database.saleSequences.clear(),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("local POS sale outbox", () => {
  it("reserves distinct local sequences for concurrent tabs", async () => {
    const [first, second] = await Promise.all([
      enqueueLocalCashSale(saleInput()),
      enqueueLocalCashSale(
        saleInput({
          eventId: "8ee5d5a9-2b49-4382-b481-8d460d741dc7",
          localReceiptId: "211de55c-c562-49a1-a4cb-d8b38915dd83",
        }),
      ),
    ]);

    expect([first.localSequence, second.localSequence].sort()).toEqual([1, 2]);
    expect(await localCashSales(scope)).toHaveLength(2);
  });

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

  it("marks a signed sale as synced only after the server acknowledges it", async () => {
    const queued = await enqueueLocalCashSale(saleInput());
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          acknowledgedAt: "2026-07-26T10:31:00.000Z",
          eventId: queued.eventId,
          journalEntryId: "6d8862fb-c1c5-4198-a0a9-017dc284b7e8",
          localReceiptId: queued.localReceiptId,
          saleId: queued.eventId,
          status: "accepted",
          stockException: false,
        },
      }),
    });
    vi.stubGlobal("fetch", fetch);

    await expect(synchronizeLocalCashSales({ device, scope })).resolves.toEqual(
      { rejected: 0, synced: 1, waiting: 0 },
    );
    await expect(localCashSales(scope)).resolves.toMatchObject([
      {
        eventId: queued.eventId,
        status: "synced",
        acknowledgement: {
          journalEntryId: "6d8862fb-c1c5-4198-a0a9-017dc284b7e8",
        },
      },
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      eventId: queued.eventId,
      deviceSignature: expect.stringMatching(/^[A-Za-z0-9_-]{86}$/),
    });
  });

  it("retains a rejected sale with its server reason for a later retry", async () => {
    const queued = await enqueueLocalCashSale(saleInput());
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        data: {
          acknowledgedAt: "2026-07-26T10:31:00.000Z",
          eventId: queued.eventId,
          rejectionCode: "POS_SHIFT_CLOSED",
          rejectionMessage: "The cash shift is closed.",
          status: "rejected",
        },
      }),
    }));

    await expect(synchronizeLocalCashSales({ device, scope })).resolves.toEqual(
      { rejected: 1, synced: 0, waiting: 0 },
    );
    await expect(localCashSales(scope)).resolves.toMatchObject([
      {
        eventId: queued.eventId,
        status: "rejected",
        acknowledgement: {
          rejectionCode: "POS_SHIFT_CLOSED",
        },
      },
    ]);
  });

  it("returns an unconfirmed delivery to pending so its immutable event can retry", async () => {
    const queued = await enqueueLocalCashSale(saleInput());
    vi.stubGlobal("fetch", async () => {
      throw new Error("Network unavailable");
    });

    await expect(synchronizeLocalCashSales({ device, scope })).resolves.toEqual(
      { rejected: 0, synced: 0, waiting: 1 },
    );
    await expect(localCashSales(scope)).resolves.toMatchObject([
      { eventId: queued.eventId, status: "pending_sync" },
    ]);
  });
});
