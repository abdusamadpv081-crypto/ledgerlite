import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { CompanyBranchService } from "../src/company/company-branch.service.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const companies = new CompanyBranchService(pool);
const suffix = randomUUID();
let companyId: string;
let actorUserId: string;

beforeAll(async () => {
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Company command service ${suffix}`],
    )
  ).rows[0].id;
  actorUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
       (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Company command test actor') RETURNING id`,
      [`company-command-${suffix}`],
    )
  ).rows[0].id;
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
      "DELETE FROM platform.command_idempotency WHERE company_id = $1",
      [companyId],
    );
    await client.query("DELETE FROM platform.branch WHERE company_id = $1", [
      companyId,
    ]);
    await client.query("DELETE FROM platform.app_user WHERE id = $1", [
      actorUserId,
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

describe("CompanyBranchService", () => {
  it("writes a command correlation ID into branch audit events", async () => {
    const created = await companies.createBranch(
      { companyId, actorUserId },
      {
        code: "MAIN",
        name: "Main branch",
        address: {},
        timeZone: "Asia/Dubai",
        status: "active",
      },
      `company-branch-${suffix}`,
    );

    const audit = await pool.query<{
      action: string;
      correlation_id: string | null;
    }>(
      `SELECT action, correlation_id::text FROM audit.event
       WHERE company_id = $1 AND entity_id = $2::uuid`,
      [companyId, created.data.id],
    );

    expect(audit.rows).toEqual([
      {
        action: "branch.created",
        correlation_id: created.correlationId,
      },
    ]);
  });
});
