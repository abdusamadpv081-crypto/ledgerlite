import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite";
const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID();

let companyAId: string;
let companyBId: string;
let branchAId: string;
let branchBId: string;

async function asCompany<T>(
  companyId: string,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.current_company_id', $1, true)",
      [companyId],
    );
    await client.query("SET LOCAL ROLE ledgerlite_app");
    const result = await callback(client);
    await client.query("ROLLBACK");
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
    `INSERT INTO platform.company (legal_name)
     VALUES ($1), ($2)
     RETURNING id`,
    [`Company A ${suffix}`, `Company B ${suffix}`],
  );
  companyAId = companies.rows[0].id;
  companyBId = companies.rows[1].id;

  const branches = await pool.query<{ id: string }>(
    `INSERT INTO platform.branch (company_id, code, name)
     VALUES ($1, 'A1', 'Branch A'), ($2, 'B1', 'Branch B')
     RETURNING id`,
    [companyAId, companyBId],
  );
  branchAId = branches.rows[0].id;
  branchBId = branches.rows[1].id;

  await pool.query(
    `INSERT INTO platform.pos_device
       (company_id, branch_id, display_name, public_key_jwk, public_key_fingerprint)
     VALUES
       ($1, $2, 'Device A', '{"kty":"EC"}', $3),
       ($4, $5, 'Device B', '{"kty":"EC"}', $6)`,
    [
      companyAId,
      branchAId,
      `a-${suffix}`,
      companyBId,
      branchBId,
      `b-${suffix}`,
    ],
  );
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM platform.pos_device WHERE company_id IN ($1, $2)",
    [companyAId, companyBId],
  );
  await pool.query("DELETE FROM platform.branch WHERE company_id IN ($1, $2)", [
    companyAId,
    companyBId,
  ]);
  await pool.query("DELETE FROM platform.company WHERE id IN ($1, $2)", [
    companyAId,
    companyBId,
  ]);
  await pool.end();
});

describe("platform tenant isolation", () => {
  it("only exposes the current company, its branches, and its devices", async () => {
    const visible = await asCompany(companyAId, async (client) => {
      const companies = await client.query(
        "SELECT id FROM platform.company ORDER BY id",
      );
      const branches = await client.query(
        "SELECT company_id FROM platform.branch ORDER BY id",
      );
      const devices = await client.query(
        "SELECT company_id FROM platform.pos_device ORDER BY id",
      );
      return { companies, branches, devices };
    });

    expect(visible.companies.rows).toEqual([{ id: companyAId }]);
    expect(visible.branches.rows).toEqual([{ company_id: companyAId }]);
    expect(visible.devices.rows).toEqual([{ company_id: companyAId }]);
  });

  it("rejects cross-tenant writes and device-to-branch mismatches", async () => {
    await expect(
      asCompany(companyAId, (client) =>
        client.query(
          "INSERT INTO platform.branch (company_id, code, name) VALUES ($1, 'X1', 'Blocked')",
          [companyBId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    await expect(
      asCompany(companyAId, (client) =>
        client.query(
          `INSERT INTO platform.pos_device
             (company_id, branch_id, display_name, public_key_jwk, public_key_fingerprint)
           VALUES ($1, $2, 'Invalid device', '{"kty":"EC"}', $3)`,
          [companyAId, branchBId, `invalid-${suffix}`],
        ),
      ),
    ).rejects.toThrow(/foreign key/i);
  });
});
