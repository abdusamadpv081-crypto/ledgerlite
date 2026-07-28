import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const suffix = randomUUID();
let companyId: string;
let branchId: string;
let deviceId: string;
let cashierId: string;
let policyId: string;
let grantId: string;
let shiftId: string;

async function asCashier<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.current_company_id', $1, true)",
      [companyId],
    );
    await client.query("SELECT set_config('app.current_actor_id', $1, true)", [
      cashierId,
    ]);
    await client.query("SET LOCAL ROLE ledgerlite_app");
    const result = await operation(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertPostedSaleJournal(
  client: PoolClient,
  eventId: string,
): Promise<string> {
  const chartId = (
    await client.query<{ id: string }>(
      `INSERT INTO accounting.chart_of_accounts
         (company_id, name, version, effective_from)
       VALUES ($1, 'POS sale chart', 1, '2026-01-01') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  const accounts = await client.query<{ id: string; code: string }>(
    `INSERT INTO accounting.account
       (company_id, chart_id, code, name, account_type, normal_balance)
     VALUES
       ($1, $2, '1000', 'Cash on hand', 'asset', 'debit'),
       ($1, $2, '2000', 'VAT payable', 'liability', 'credit'),
       ($1, $2, '4000', 'Retail sales', 'revenue', 'credit')
     RETURNING id, code`,
    [companyId, chartId],
  );
  const account = new Map(accounts.rows.map((row) => [row.code, row.id]));
  const periodId = (
    await client.query<{ id: string }>(
      `INSERT INTO accounting.fiscal_period
         (company_id, name, starts_on, ends_on)
       VALUES ($1, 'FY26', '2026-01-01', '2027-01-01') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  const journalId = (
    await client.query<{ id: string }>(
      `INSERT INTO accounting.journal_entry
         (company_id, fiscal_period_id, journal_date, entry_type, description,
          source_type, source_id, created_by_user_id)
       VALUES ($1, $2, '2026-07-28', 'system', 'POS cash sale', 'pos.sale', $3, $4)
       RETURNING id`,
      [companyId, periodId, eventId, cashierId],
    )
  ).rows[0].id;
  await client.query(
    `INSERT INTO accounting.journal_line
       (company_id, journal_entry_id, account_id, line_number, debit_amount, credit_amount)
     VALUES
       ($1, $2, $3, 1, 105, 0),
       ($1, $2, $4, 2, 0, 5),
       ($1, $2, $5, 3, 0, 100)`,
    [
      companyId,
      journalId,
      account.get("1000"),
      account.get("2000"),
      account.get("4000"),
    ],
  );
  await client.query("SELECT accounting.post_journal_entry($1)", [journalId]);
  return journalId;
}

beforeAll(async () => {
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`POS sale sync ${suffix}`],
    )
  ).rows[0].id;
  branchId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.branch (company_id, code, name)
       VALUES ($1, 'MAIN', 'Main branch') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  deviceId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.pos_device
         (company_id, branch_id, display_name, public_key_jwk, public_key_fingerprint)
       VALUES ($1, $2, 'Sale sync device', '{"kty":"EC"}', $3) RETURNING id`,
      [companyId, branchId, `sale-sync-device-${suffix}`],
    )
  ).rows[0].id;
  cashierId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
         (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'POS cashier') RETURNING id`,
      [`sale-sync-cashier-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO platform.company_user (company_id, user_id) VALUES ($1, $2)",
    [companyId, cashierId],
  );
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
       VALUES ($1, $2, $3, $4, $5, 1, ARRAY['pos.sale.create'],
               decode(repeat('a1', 32), 'hex'), '2026-07-28T08:00:00Z',
               '2026-07-29T08:00:00Z')
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
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
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
    await client.query("DELETE FROM platform.company WHERE id = $1", [
      companyId,
    ]);
    await client.query("COMMIT");
  } finally {
    client.release();
    await pool.end();
  }
});

describe("POS sale synchronization database foundation", () => {
  it("forces RLS and accepts only a complete immutable sale/journal/movement set", async () => {
    const rls = await pool.query<{ relforcerowsecurity: boolean }>(
      `SELECT relforcerowsecurity
       FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
       WHERE (nspname, relname) IN (
         ('pos', 'sale_event'), ('pos', 'sale_line'), ('inventory', 'stock_movement')
       )`,
    );
    expect(rls.rows).toHaveLength(3);
    expect(rls.rows.every((row) => row.relforcerowsecurity)).toBe(true);

    await asCashier(async (client) => {
      const eventId = randomUUID();
      const receiptId = randomUUID();
      const taxId = (
        await client.query<{ id: string }>(
          `INSERT INTO catalog.tax_code (company_id, code, name, rate)
           VALUES ($1, 'VAT5', 'UAE VAT', 0.05) RETURNING id`,
          [companyId],
        )
      ).rows[0].id;
      const productId = (
        await client.query<{ id: string }>(
          `INSERT INTO catalog.product
             (company_id, sku, name, product_kind, default_tax_code_id)
           VALUES ($1, 'SYNC-STOCK', 'Sync stock item', 'stock', $2) RETURNING id`,
          [companyId, taxId],
        )
      ).rows[0].id;
      const journalId = await insertPostedSaleJournal(client, eventId);
      await client.query(
        `INSERT INTO pos.sale_event
           (id, company_id, branch_id, device_id, cashier_user_id, cash_shift_id,
            offline_grant_id, policy_id, policy_version, schema_version, event_type,
            local_receipt_id, local_sequence, occurred_at, currency_code,
            payment_method, net_amount, tax_amount, total_amount, payment_amount,
            payload_digest, device_signature, stock_exception, journal_entry_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 1, 'cash_sale',
                 $9, 1, '2026-07-28T09:00:00Z', 'AED', 'cash', 100, 5, 105, 105,
                 decode(repeat('b2', 32), 'hex'), decode(repeat('c3', 64), 'hex'),
                 true, $10)`,
        [
          eventId,
          companyId,
          branchId,
          deviceId,
          cashierId,
          shiftId,
          grantId,
          policyId,
          receiptId,
          journalId,
        ],
      );
      const lineId = (
        await client.query<{ id: string }>(
          `INSERT INTO pos.sale_line
             (company_id, sale_event_id, line_number, product_id, product_name, sku,
              quantity, unit_price, tax_treatment, tax_code_id, tax_code, tax_name,
              tax_rate, net_amount, tax_amount, total_amount)
           VALUES ($1, $2, 1, $3, 'Sync stock item', 'SYNC-STOCK', 1, 100,
                   'exclusive', $4, 'VAT5', 'UAE VAT', 0.05, 100, 5, 105)
           RETURNING id`,
          [companyId, eventId, productId, taxId],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO inventory.stock_movement
           (company_id, branch_id, product_id, sale_line_id, movement_type,
            quantity_delta, occurred_at)
         VALUES ($1, $2, $3, $4, 'sale', -1, '2026-07-28T09:00:00Z')`,
        [companyId, branchId, productId, lineId],
      );
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");

      await expect(
        client.query("SELECT inventory.stock_on_hand($1, $2) AS quantity", [
          branchId,
          productId,
        ]),
      ).resolves.toMatchObject({ rows: [{ quantity: "-1.000000" }] });
      await client.query("SAVEPOINT sale_immutable");
      await expect(
        client.query(
          "UPDATE pos.sale_event SET total_amount = 1 WHERE id = $1",
          [eventId],
        ),
      ).rejects.toThrow(/permission denied|immutable/i);
      await client.query("ROLLBACK TO SAVEPOINT sale_immutable");
    });
  });
});
