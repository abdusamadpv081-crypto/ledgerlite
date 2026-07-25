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
let branchId: string;
let userId: string;
const reference = `OPS-${suffix}`;

beforeAll(async () => {
  userId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user (identity_provider, external_subject, display_name)
       VALUES ('test-oidc', $1, 'Provisioned owner')
       RETURNING id`,
      [`provisioning-owner-${suffix}`],
    )
  ).rows[0].id;

  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Provisioned company ${suffix}`],
    )
  ).rows[0].id;

  branchId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.branch (company_id, code, name)
       VALUES ($1, 'MAIN', 'Main branch')
       RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM platform.company_provisioning WHERE external_reference = $1",
    [reference],
  );
  await pool.query("DELETE FROM platform.branch WHERE id = $1", [branchId]);
  await pool.query("DELETE FROM platform.company WHERE id = $1", [companyId]);
  await pool.query("DELETE FROM platform.app_user WHERE id = $1", [userId]);
  await pool.end();
});

describe("operator company provisioning schema", () => {
  it("makes the external operations reference immutable and idempotent", async () => {
    await pool.query(
      `INSERT INTO platform.company_provisioning
         (external_reference, company_id, initial_branch_id, owner_user_id)
       VALUES ($1, $2, $3, $4)`,
      [reference, companyId, branchId, userId],
    );

    await expect(
      pool.query(
        `INSERT INTO platform.company_provisioning
           (external_reference, company_id, initial_branch_id, owner_user_id)
         VALUES ($1, $2, $3, $4)`,
        [reference, companyId, branchId, userId],
      ),
    ).rejects.toThrow(/company_provisioning_external_reference_key/i);
  });

  it("does not grant runtime application access to operator records", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE ledgerlite_app");
      await expect(
        client.query("SELECT * FROM platform.company_provisioning"),
      ).rejects.toThrow(/permission denied/i);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("grants the dedicated operator role provisioning record access", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE ledgerlite_operator");
      const result = await client.query(
        "SELECT external_reference FROM platform.company_provisioning WHERE external_reference = $1",
        [reference],
      );
      expect(result.rows).toEqual([{ external_reference: reference }]);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
