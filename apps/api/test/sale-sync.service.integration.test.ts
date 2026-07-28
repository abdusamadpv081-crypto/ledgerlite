import { randomUUID, webcrypto } from "node:crypto";

import {
  posCashSaleSignaturePayload,
  type PosCashSaleEvent,
} from "@ledgerlite/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  SaleSyncService,
  type SaleSyncInput,
} from "../src/pos/sale-sync.service.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const sales = new SaleSyncService(pool);
const suffix = randomUUID();
let companyId: string;
let otherCompanyId: string;
let branchId: string;
let cashierId: string;
let deviceId: string;
let policyId: string;
let grantId: string;
let shiftId: string;
let productId: string;
let taxCodeId: string;
let signingKey: CryptoKey;

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

async function signedSale(
  overrides: Partial<PosCashSaleEvent> = {},
): Promise<SaleSyncInput> {
  const event: PosCashSaleEvent = {
    schemaVersion: 1,
    eventType: "cash_sale",
    eventId: randomUUID(),
    localReceiptId: randomUUID(),
    localSequence: 1,
    companyId,
    branchId,
    deviceId,
    cashierUserId: cashierId,
    shiftId,
    authorityGrantId: grantId,
    authorityPolicyId: policyId,
    authorityPolicyVersion: 1,
    occurredAt: new Date().toISOString(),
    currency: "AED",
    payment: { method: "cash", amount: "105.000000" },
    lines: [
      {
        productId,
        productName: "Signed stock item",
        sku: "SYNC-1",
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
    ...overrides,
  };
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    arrayBuffer(posCashSaleSignaturePayload(event)),
  );
  return {
    ...event,
    deviceSignature: Buffer.from(signature).toString("base64url"),
  };
}

beforeAll(async () => {
  const keys = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  signingKey = keys.privateKey;
  const publicKey = await webcrypto.subtle.exportKey("jwk", keys.publicKey);

  const companies = await pool.query<{ id: string }>(
    "INSERT INTO platform.company (legal_name) VALUES ($1), ($2) RETURNING id",
    [`Sale sync ${suffix}`, `Other sale sync ${suffix}`],
  );
  companyId = companies.rows[0].id;
  otherCompanyId = companies.rows[1].id;
  branchId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.branch (company_id, code, name)
       VALUES ($1, 'MAIN', 'Main branch') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  cashierId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
         (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Sale sync cashier') RETURNING id`,
      [`sale-sync-cashier-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO platform.company_user (company_id, user_id) VALUES ($1, $2)",
    [companyId, cashierId],
  );
  deviceId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.pos_device
         (company_id, branch_id, display_name, public_key_jwk, public_key_fingerprint)
       VALUES ($1, $2, 'Signed POS', $3::jsonb, $4) RETURNING id`,
      [companyId, branchId, JSON.stringify(publicKey), `sale-sync-${suffix}`],
    )
  ).rows[0].id;
  policyId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.policy_version (company_id, version)
       VALUES ($1, 1) RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  grantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO pos.offline_operational_grant
         (company_id, branch_id, device_id, cashier_user_id, policy_id,
          policy_version, capabilities, token_digest, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 1,
               ARRAY['pos.shift.operate', 'pos.sale.create'],
               decode(repeat('d4', 32), 'hex'), clock_timestamp() - interval '1 minute',
               clock_timestamp() + interval '1 hour')
       RETURNING id`,
      [companyId, branchId, deviceId, cashierId, policyId],
    )
  ).rows[0].id;
  shiftId = (
    await pool.query<{ id: string }>(
      `INSERT INTO pos.cash_shift
         (company_id, branch_id, device_id, cashier_user_id, currency_code,
          opening_float, policy_id, policy_version)
       VALUES ($1, $2, $3, $4, 'AED', 0, $5, 1) RETURNING id`,
      [companyId, branchId, deviceId, cashierId, policyId],
    )
  ).rows[0].id;
  taxCodeId = (
    await pool.query<{ id: string }>(
      `INSERT INTO catalog.tax_code (company_id, code, name, rate)
       VALUES ($1, 'VAT5', 'UAE VAT', 0.05) RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  productId = (
    await pool.query<{ id: string }>(
      `INSERT INTO catalog.product
         (company_id, sku, name, product_kind, default_tax_code_id)
       VALUES ($1, 'SYNC-1', 'Signed stock item', 'stock', $2) RETURNING id`,
      [companyId, taxCodeId],
    )
  ).rows[0].id;
  const chartId = (
    await pool.query<{ id: string }>(
      `INSERT INTO accounting.chart_of_accounts
         (company_id, name, version, effective_from)
       VALUES ($1, 'Sale sync chart', 1, '2026-01-01') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO accounting.account
       (company_id, chart_id, code, name, account_type, normal_balance)
     VALUES
       ($1, $2, '1000', 'Cash on hand', 'asset', 'debit'),
       ($1, $2, '2000', 'VAT payable', 'liability', 'credit'),
       ($1, $2, '4000', 'Retail sales', 'revenue', 'credit')`,
    [companyId, chartId],
  );
  await pool.query(
    `INSERT INTO accounting.fiscal_period
       (company_id, name, starts_on, ends_on)
     VALUES ($1, 'Current fiscal period',
             date_trunc('year', current_date)::date,
             (date_trunc('year', current_date) + interval '1 year')::date)`,
    [companyId],
  );
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("DELETE FROM audit.event WHERE company_id = $1", [
      companyId,
    ]);
    await client.query(
      "DELETE FROM inventory.stock_movement WHERE company_id = $1",
      [companyId],
    );
    await client.query("DELETE FROM pos.sale_line WHERE company_id = $1", [
      companyId,
    ]);
    await client.query("DELETE FROM pos.sale_event WHERE company_id = $1", [
      companyId,
    ]);
    await client.query(
      "DELETE FROM accounting.journal_line WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM accounting.journal_entry WHERE company_id = $1",
      [companyId],
    );
    await client.query("DELETE FROM accounting.account WHERE company_id = $1", [
      companyId,
    ]);
    await client.query(
      "DELETE FROM accounting.chart_of_accounts WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM accounting.fiscal_period WHERE company_id = $1",
      [companyId],
    );
    await client.query("DELETE FROM catalog.product WHERE company_id = $1", [
      companyId,
    ]);
    await client.query("DELETE FROM catalog.tax_code WHERE company_id = $1", [
      companyId,
    ]);
    await client.query("DELETE FROM pos.cash_shift WHERE company_id = $1", [
      companyId,
    ]);
    await client.query(
      "DELETE FROM pos.offline_operational_grant WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM platform.policy_version WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM platform.pos_device WHERE company_id = $1",
      [companyId],
    );
    await client.query("DELETE FROM platform.branch WHERE company_id = $1", [
      companyId,
    ]);
    await client.query(
      "DELETE FROM platform.company_user WHERE company_id = $1",
      [companyId],
    );
    await client.query("DELETE FROM platform.app_user WHERE id = $1", [
      cashierId,
    ]);
    await client.query("DELETE FROM platform.company WHERE id IN ($1, $2)", [
      companyId,
      otherCompanyId,
    ]);
    await client.query("COMMIT");
  } finally {
    client.release();
    await pool.end();
  }
});

describe("SaleSyncService", () => {
  it("verifies a device-signed offline sale and posts one stock/journal/audit effect across retries", async () => {
    const input = await signedSale();
    const context = { companyId, actorUserId: cashierId };

    const accepted = await sales.sync(context, branchId, input);
    expect(accepted.data).toMatchObject({
      eventId: input.eventId,
      localReceiptId: input.localReceiptId,
      status: "accepted_with_stock_exception",
      stockException: true,
    });
    const retried = await sales.sync(context, branchId, input);
    expect(retried.data).toMatchObject({
      eventId: input.eventId,
      journalEntryId: (accepted.data as { journalEntryId: string })
        .journalEntryId,
      status: "duplicate_accepted",
      stockException: true,
    });
    const effects = await pool.query<{
      sale_count: string;
      line_count: string;
      movement_count: string;
      journal_count: string;
      audit_count: string;
    }>(
      `SELECT
         (SELECT count(*) FROM pos.sale_event WHERE company_id = $1)::text AS sale_count,
         (SELECT count(*) FROM pos.sale_line WHERE company_id = $1)::text AS line_count,
         (SELECT count(*) FROM inventory.stock_movement WHERE company_id = $1)::text AS movement_count,
         (SELECT count(*) FROM accounting.journal_entry WHERE company_id = $1
           AND source_id = $2::uuid)::text AS journal_count,
         (SELECT count(*) FROM audit.event WHERE company_id = $1
           AND action = 'pos.sale.accepted')::text AS audit_count`,
      [companyId, input.eventId],
    );
    expect(effects.rows[0]).toEqual({
      sale_count: "1",
      line_count: "1",
      movement_count: "1",
      journal_count: "1",
      audit_count: "1",
    });
  });

  it("returns stable rejections without creating financial effects", async () => {
    const valid = await signedSale({ localSequence: 2 });
    const tampered = {
      ...valid,
      eventId: randomUUID(),
      totals: { ...valid.totals, totalAmount: "106.000000" },
    };
    const invalidSignature = await sales.sync(
      { companyId, actorUserId: cashierId },
      branchId,
      tampered,
    );
    expect(invalidSignature.data).toMatchObject({
      acknowledgedAt: expect.any(String),
      status: "rejected",
      rejectionCode: "EVENT_SIGNATURE_INVALID",
    });

    const crossTenant = await sales.sync(
      { companyId, actorUserId: cashierId },
      branchId,
      { ...valid, companyId: otherCompanyId },
    );
    expect(crossTenant.data).toMatchObject({
      status: "rejected",
      rejectionCode: "EVENT_SCOPE_MISMATCH",
    });
    const saleCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pos.sale_event WHERE company_id = $1",
      [companyId],
    );
    expect(saleCount.rows[0].count).toBe("1");
  });
});
