import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const suffix = randomUUID();
let companyId: string;
let cashierId: string;
let otherCashierId: string;

async function asCashier<T>(
  company: string,
  actor: string,
  operation: (client: import("pg").PoolClient) => Promise<T>,
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
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Cashier PIN test ${suffix}`],
    )
  ).rows[0].id;
  cashierId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
       (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Cashier one') RETURNING id`,
      [`cashier-one-${suffix}`],
    )
  ).rows[0].id;
  otherCashierId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
       (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Cashier two') RETURNING id`,
      [`cashier-two-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO platform.company_user (company_id, user_id)
     VALUES ($1, $2), ($1, $3)`,
    [companyId, cashierId, otherCashierId],
  );
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("DELETE FROM pos.cashier_pin WHERE company_id = $1", [
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
    await client.query("DELETE FROM platform.company WHERE id = $1", [
      companyId,
    ]);
    await client.query("COMMIT");
  } finally {
    client.release();
    await pool.end();
  }
});

describe("cashier PIN foundation", () => {
  it("enforces self-only tenant writes and a monotonic verifier version", async () => {
    const salt = Buffer.alloc(16, 1);
    const hash = Buffer.alloc(32, 2);
    await asCashier(companyId, cashierId, (client) =>
      client.query(
        `INSERT INTO pos.cashier_pin
           (company_id, cashier_user_id, salt, hash)
         VALUES ($1, $2, $3, $4)`,
        [companyId, cashierId, salt, hash],
      ),
    );
    await expect(
      asCashier(companyId, otherCashierId, (client) =>
        client.query(
          `UPDATE pos.cashier_pin SET hash = $1, version = 2,
           changed_at = clock_timestamp()
           WHERE company_id = $2 AND cashier_user_id = $3`,
          [Buffer.alloc(32, 3), companyId, cashierId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asCashier(companyId, cashierId, (client) =>
        client.query(
          `UPDATE pos.cashier_pin SET hash = $1, version = 3,
           changed_at = clock_timestamp()
           WHERE company_id = $2 AND cashier_user_id = $3`,
          [Buffer.alloc(32, 3), companyId, cashierId],
        ),
      ),
    ).rejects.toThrow("next version");
    await asCashier(companyId, cashierId, (client) =>
      client.query<{ version: number }>(
        `UPDATE pos.cashier_pin SET hash = $1, version = 2,
         changed_at = clock_timestamp()
         WHERE company_id = $2 AND cashier_user_id = $3`,
        [Buffer.alloc(32, 3), companyId, cashierId],
      ),
    );
    await expect(
      pool.query<{ version: number }>(
        `SELECT version FROM pos.cashier_pin
         WHERE company_id = $1 AND cashier_user_id = $2`,
        [companyId, cashierId],
      ),
    ).resolves.toMatchObject({ rows: [{ version: 2 }] });
  });
});
