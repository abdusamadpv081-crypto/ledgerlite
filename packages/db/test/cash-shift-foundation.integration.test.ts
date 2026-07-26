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
let otherCompanyId: string;
let branchId: string;
let deviceId: string;
let secondDeviceId: string;
let cashierId: string;
let otherCashierId: string;
let policyId: string;
let shiftId: string;

async function asCashier<T>(
  company: string,
  actor: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.current_company_id', $1, true)",
      [company],
    );
    await client.query("SELECT set_config('app.current_actor_id', $1, true)", [
      actor,
    ]);
    await client.query("SET LOCAL ROLE ledgerlite_app");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  const companies = await pool.query<{ id: string }>(
    "INSERT INTO platform.company (legal_name) VALUES ($1), ($2) RETURNING id",
    [`Cash shift ${suffix}`, `Other cash shift ${suffix}`],
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
  const devices = await pool.query<{ id: string }>(
    `INSERT INTO platform.pos_device
       (company_id, branch_id, display_name, public_key_jwk, public_key_fingerprint)
     VALUES
       ($1, $2, 'Cash shift device one', '{"kty":"EC"}', $3),
       ($1, $2, 'Cash shift device two', '{"kty":"EC"}', $4)
     RETURNING id`,
    [
      companyId,
      branchId,
      `cash-shift-device-one-${suffix}`,
      `cash-shift-device-two-${suffix}`,
    ],
  );
  deviceId = devices.rows[0].id;
  secondDeviceId = devices.rows[1].id;
  const cashiers = await pool.query<{ id: string }>(
    `INSERT INTO platform.app_user
       (identity_provider, external_subject, display_name)
     VALUES
       ('test', $1, 'Cashier one'),
       ('test', $2, 'Cashier two')
     RETURNING id`,
    [`cash-shift-cashier-one-${suffix}`, `cash-shift-cashier-two-${suffix}`],
  );
  cashierId = cashiers.rows[0].id;
  otherCashierId = cashiers.rows[1].id;
  await pool.query(
    `INSERT INTO platform.company_user (company_id, user_id)
     VALUES ($1, $2), ($1, $3)`,
    [companyId, cashierId, otherCashierId],
  );
  policyId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.policy_version (company_id, version)
       VALUES ($1, 1) RETURNING id`,
      [companyId],
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
    await client.query("DELETE FROM platform.app_user WHERE id IN ($1, $2)", [
      cashierId,
      otherCashierId,
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

describe("cash shift opening foundation", () => {
  it("isolates cashier shifts, protects opening data, and prevents concurrent tills", async () => {
    shiftId = (
      await asCashier(companyId, cashierId, (client) =>
        client.query<{ id: string }>(
          `INSERT INTO pos.cash_shift
             (company_id, branch_id, device_id, cashier_user_id, currency_code,
              opening_float, policy_id, policy_version)
           VALUES ($1, $2, $3, $4, 'AED', 250.50, $5, 1)
           RETURNING id`,
          [companyId, branchId, deviceId, cashierId, policyId],
        ),
      )
    ).rows[0].id;

    await expect(
      asCashier(companyId, otherCashierId, (client) =>
        client.query("SELECT id FROM pos.cash_shift"),
      ),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      asCashier(otherCompanyId, cashierId, (client) =>
        client.query("SELECT id FROM pos.cash_shift"),
      ),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      asCashier(companyId, otherCashierId, (client) =>
        client.query(
          `INSERT INTO pos.cash_shift
             (company_id, branch_id, device_id, cashier_user_id, currency_code,
              opening_float, policy_id, policy_version)
           VALUES ($1, $2, $3, $4, 'AED', 10, $5, 1)`,
          [companyId, branchId, deviceId, otherCashierId, policyId],
        ),
      ),
    ).rejects.toThrow(/cash_shift_active_device_key/i);
    await expect(
      asCashier(companyId, cashierId, (client) =>
        client.query(
          `INSERT INTO pos.cash_shift
             (company_id, branch_id, device_id, cashier_user_id, currency_code,
              opening_float, policy_id, policy_version)
           VALUES ($1, $2, $3, $4, 'AED', 10, $5, 1)`,
          [companyId, branchId, secondDeviceId, cashierId, policyId],
        ),
      ),
    ).rejects.toThrow(/cash_shift_active_cashier_key/i);
    await expect(
      asCashier(companyId, cashierId, (client) =>
        client.query(
          "UPDATE pos.cash_shift SET status = 'closed' WHERE id = $1",
          [shiftId],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asCashier(companyId, otherCashierId, (client) =>
        client.query(
          `INSERT INTO pos.cash_shift
             (company_id, branch_id, device_id, cashier_user_id, currency_code,
              opening_float, policy_id, policy_version)
           VALUES ($1, $2, $3, $4, 'AED', 1.001, $5, 1)`,
          [companyId, branchId, secondDeviceId, otherCashierId, policyId],
        ),
      ),
    ).rejects.toThrow(/cash_shift_opening_float_check/i);
  });
});
