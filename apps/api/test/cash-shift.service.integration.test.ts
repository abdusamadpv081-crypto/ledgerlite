import { randomUUID } from "node:crypto";

import { ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { CashShiftService } from "../src/pos/cash-shift.service.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const suffix = randomUUID();
let companyId: string;
let branchId: string;
let actorUserId: string;
let deviceId: string;
let shifts: CashShiftService;

beforeAll(async () => {
  shifts = new CashShiftService(pool);
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Cash shift service ${suffix}`],
    )
  ).rows[0].id;
  branchId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.branch (company_id, code, name)
       VALUES ($1, 'MAIN', 'Main branch') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  actorUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
       (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Cash shift test user') RETURNING id`,
      [`cash-shift-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO platform.company_user (company_id, user_id) VALUES ($1, $2)",
    [companyId, actorUserId],
  );
  deviceId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.pos_device
         (company_id, branch_id, display_name, public_key_jwk,
          public_key_fingerprint)
       VALUES ($1, $2, 'Till one', $3::jsonb, $4) RETURNING id`,
      [
        companyId,
        branchId,
        { crv: "P-256", kty: "EC", x: "A".repeat(43), y: "B".repeat(43) },
        `cash-shift-${suffix}`,
      ],
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
    await client.query(
      "DELETE FROM platform.company_user WHERE company_id = $1",
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

describe("CashShiftService", () => {
  it("opens an idempotent, audited cash shift without creating a journal", async () => {
    const context = { companyId, actorUserId };
    const input = { deviceId, openingFloat: "125.50" };
    const first = await shifts.open(
      context,
      branchId,
      input,
      `cash-shift-open-${suffix}`,
    );
    const retried = await shifts.open(
      context,
      branchId,
      input,
      `cash-shift-open-${suffix}`,
    );
    const current = await shifts.current(context, branchId);

    expect(retried).toEqual(first);
    expect(first.data).toMatchObject({
      branchId,
      deviceId,
      cashierUserId: actorUserId,
      currencyCode: "AED",
      openingFloat: "125.50",
      status: "open",
      policyVersion: 1,
    });
    expect(current).toEqual(first.data);
    await expect(
      shifts.open(
        context,
        branchId,
        { deviceId, openingFloat: "10.00" },
        `cash-shift-duplicate-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const [stored, audit, journals] = await Promise.all([
      pool.query<{ opening_float: string; status: string }>(
        `SELECT opening_float::text, status FROM pos.cash_shift
         WHERE company_id = $1`,
        [companyId],
      ),
      pool.query<{ action: string; correlation_id: string | null }>(
        `SELECT action, correlation_id::text FROM audit.event
         WHERE company_id = $1`,
        [companyId],
      ),
      pool.query(
        "SELECT id FROM accounting.journal_entry WHERE company_id = $1",
        [companyId],
      ),
    ]);
    expect(stored.rows).toEqual([
      { opening_float: "125.500000", status: "open" },
    ]);
    expect(audit.rows).toEqual([
      { action: "pos.cash_shift.opened", correlation_id: first.correlationId },
    ]);
    expect(journals.rows).toEqual([]);
  });
});
