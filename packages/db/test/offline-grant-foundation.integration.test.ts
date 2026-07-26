import { randomBytes, randomUUID } from "node:crypto";

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
let cashierId: string;
let policyId: string;
let challengeId: string;
let grantId: string;

async function asCompany<T>(
  id: string,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.current_company_id', $1, true)",
      [id],
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
    "INSERT INTO platform.company (legal_name) VALUES ($1), ($2) RETURNING id",
    [`Offline grants ${suffix}`, `Other offline grants ${suffix}`],
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
  deviceId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.pos_device
         (company_id, branch_id, display_name, public_key_jwk, public_key_fingerprint)
       VALUES ($1, $2, 'Offline grant test device', '{"kty":"EC"}', $3)
       RETURNING id`,
      [companyId, branchId, `offline-grant-device-${suffix}`],
    )
  ).rows[0].id;
  cashierId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
         (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Offline grant cashier') RETURNING id`,
      [`offline-grant-cashier-${suffix}`],
    )
  ).rows[0].id;
  policyId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.policy_version (company_id, version)
       VALUES ($1, 1) RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  challengeId = (
    await pool.query<{ id: string }>(
      `INSERT INTO pos.offline_grant_challenge
         (company_id, branch_id, device_id, cashier_user_id, nonce_digest, expires_at)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp() + interval '5 minutes')
       RETURNING id`,
      [companyId, branchId, deviceId, cashierId, randomBytes(32)],
    )
  ).rows[0].id;
  grantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO pos.offline_operational_grant
         (company_id, branch_id, device_id, cashier_user_id, policy_id,
          policy_version, capabilities, token_digest, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 1, ARRAY['pos.shift.operate'], $6,
               clock_timestamp(), clock_timestamp() + interval '72 hours')
       RETURNING id`,
      [companyId, branchId, deviceId, cashierId, policyId, randomBytes(32)],
    )
  ).rows[0].id;
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM pos.offline_operational_grant WHERE company_id IN ($1, $2)",
    [companyId, otherCompanyId],
  );
  await pool.query(
    "DELETE FROM pos.offline_grant_challenge WHERE company_id IN ($1, $2)",
    [companyId, otherCompanyId],
  );
  await pool.query(
    "DELETE FROM platform.policy_version WHERE company_id IN ($1, $2)",
    [companyId, otherCompanyId],
  );
  await pool.query("DELETE FROM platform.pos_device WHERE company_id = $1", [
    companyId,
  ]);
  await pool.query("DELETE FROM platform.branch WHERE company_id = $1", [
    companyId,
  ]);
  await pool.query("DELETE FROM platform.company WHERE id IN ($1, $2)", [
    companyId,
    otherCompanyId,
  ]);
  await pool.query("DELETE FROM platform.app_user WHERE id = $1", [cashierId]);
  await pool.end();
});

describe("offline grant database foundation", () => {
  it("isolates tenant grant records and permits only lifecycle transitions", async () => {
    const visible = await asCompany(companyId, async (client) =>
      Promise.all([
        client.query("SELECT id FROM pos.offline_grant_challenge"),
        client.query("SELECT id FROM pos.offline_operational_grant"),
      ]),
    );

    expect(visible[0].rows).toEqual([{ id: challengeId }]);
    expect(visible[1].rows).toEqual([{ id: grantId }]);

    await expect(
      asCompany(otherCompanyId, (client) =>
        client.query("SELECT id FROM pos.offline_operational_grant"),
      ),
    ).resolves.toMatchObject({ rows: [] });

    await expect(
      asCompany(companyId, (client) =>
        client.query(
          "UPDATE pos.offline_grant_challenge SET expires_at = clock_timestamp() WHERE id = $1",
          [challengeId],
        ),
      ),
    ).rejects.toThrow(/may only be consumed once/i);
    await expect(
      asCompany(companyId, (client) =>
        client.query(
          "UPDATE pos.offline_operational_grant SET expires_at = clock_timestamp() WHERE id = $1",
          [grantId],
        ),
      ),
    ).rejects.toThrow(/may only be revoked once/i);

    await asCompany(companyId, async (client) => {
      await client.query(
        "UPDATE pos.offline_grant_challenge SET consumed_at = clock_timestamp() WHERE id = $1",
        [challengeId],
      );
      await client.query(
        `UPDATE pos.offline_operational_grant
         SET revoked_at = clock_timestamp(), revoked_reason = 'Device retired'
         WHERE id = $1`,
        [grantId],
      );
    });
  });
});
