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
let otherCompanyId: string;
let assignedBranchId: string;
let userId: string;

beforeAll(async () => {
  userId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
         (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Assigned branch context user') RETURNING id`,
      [`branch-context-${suffix}`],
    )
  ).rows[0].id;
  const companies = await pool.query<{ id: string }>(
    `INSERT INTO platform.company (legal_name)
     VALUES ($1), ($2) RETURNING id`,
    [`Branch contexts ${suffix}`, `Other branch contexts ${suffix}`],
  );
  companyId = companies.rows[0].id;
  otherCompanyId = companies.rows[1].id;
  assignedBranchId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.branch (company_id, code, name)
       VALUES ($1, 'MAIN', 'Main branch') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO platform.branch (company_id, code, name)
     VALUES ($1, 'OTHER', 'Other branch'), ($2, 'OUTSIDE', 'Outside branch')`,
    [companyId, otherCompanyId],
  );
  const membershipId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.company_user (company_id, user_id)
       VALUES ($1, $2) RETURNING id`,
      [companyId, userId],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO platform.role_assignment
       (company_id, company_user_id, branch_id, role_template)
     VALUES ($1, $2, $3, 'branch_manager')`,
    [companyId, membershipId, assignedBranchId],
  );
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM platform.role_assignment WHERE company_id IN ($1, $2)",
    [companyId, otherCompanyId],
  );
  await pool.query(
    "DELETE FROM platform.company_user WHERE company_id IN ($1, $2)",
    [companyId, otherCompanyId],
  );
  await pool.query("DELETE FROM platform.branch WHERE company_id IN ($1, $2)", [
    companyId,
    otherCompanyId,
  ]);
  await pool.query("DELETE FROM platform.company WHERE id IN ($1, $2)", [
    companyId,
    otherCompanyId,
  ]);
  await pool.query("DELETE FROM platform.app_user WHERE id = $1", [userId]);
  await pool.end();
});

describe("platform.list_active_branch_contexts", () => {
  it("returns only the active actor's explicitly assigned active branch", async () => {
    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(
        "SELECT set_config('app.current_actor_id', $1, true)",
        [userId],
      );
      await client.query("SET LOCAL ROLE ledgerlite_app");
      const result = await client.query<{
        company_id: string;
        branch_id: string;
        branch_code: string;
        branch_name: string;
      }>("SELECT * FROM platform.list_active_branch_contexts()");
      expect(result.rows).toEqual([
        {
          company_id: companyId,
          branch_id: assignedBranchId,
          branch_code: "MAIN",
          branch_name: "Main branch",
        },
      ]);
      await client.query("COMMIT");
      transactionStarted = false;
    } finally {
      if (transactionStarted) await client.query("ROLLBACK");
      client.release();
    }
  });
});
