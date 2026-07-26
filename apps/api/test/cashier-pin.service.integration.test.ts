import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { CashierPinService } from "../src/pos/cashier-pin.service.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const suffix = randomUUID();
const originalPepper = process.env.POS_PIN_PEPPER;
let companyId: string;
let branchId: string;
let actorUserId: string;
let deviceId: string;
let pins: CashierPinService;

beforeAll(async () => {
  process.env.POS_PIN_PEPPER = randomBytes(32).toString("base64url");
  pins = new CashierPinService(pool);
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Cashier PIN service ${suffix}`],
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
       VALUES ('test', $1, 'Cashier PIN test user') RETURNING id`,
      [`cashier-pin-${suffix}`],
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
        `cashier-pin-${suffix}`,
      ],
    )
  ).rows[0].id;
});

afterAll(async () => {
  if (originalPepper === undefined) delete process.env.POS_PIN_PEPPER;
  else process.env.POS_PIN_PEPPER = originalPepper;
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
    await client.query("DELETE FROM pos.cashier_pin WHERE company_id = $1", [
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

describe("CashierPinService", () => {
  it("hashes and versions the cashier PIN without retaining a raw PIN fingerprint", async () => {
    const context = { companyId, actorUserId };
    const input = { deviceId, pin: "82537491" };
    const first = await pins.set(
      context,
      branchId,
      input,
      `cashier-pin-set-${suffix}`,
    );
    const retried = await pins.set(
      context,
      branchId,
      input,
      `cashier-pin-set-${suffix}`,
    );
    const replaced = await pins.set(
      context,
      branchId,
      { deviceId, pin: "91382746" },
      `cashier-pin-replace-${suffix}`,
    );

    expect(retried).toEqual(first);
    expect(first.data).toMatchObject({
      pinVersion: 1,
      policy: {
        minLength: 8,
        maxLength: 12,
        maxFailedAttempts: 5,
        coolOffMinutes: 15,
        maxSessionHours: 12,
      },
    });
    expect(replaced.data.pinVersion).toBe(2);

    const [stored, command, audit] = await Promise.all([
      pool.query<{ hash: Buffer; salt: Buffer; version: number }>(
        `SELECT hash, salt, version FROM pos.cashier_pin
         WHERE company_id = $1 AND cashier_user_id = $2`,
        [companyId, actorUserId],
      ),
      pool.query<{ response: unknown }>(
        `SELECT response FROM platform.command_idempotency
         WHERE company_id = $1 AND command = 'pos.cashier_pin.set'`,
        [companyId],
      ),
      pool.query<{ action: string; correlation_id: string | null }>(
        `SELECT action, correlation_id::text FROM audit.event
         WHERE company_id = $1 ORDER BY occurred_at`,
        [companyId],
      ),
    ]);
    expect(stored.rows[0]).toMatchObject({ version: 2 });
    expect(stored.rows[0].hash).toHaveLength(32);
    expect(stored.rows[0].salt).toHaveLength(16);
    expect(JSON.stringify(command.rows)).not.toContain(input.pin);
    expect(audit.rows.map((event) => event.action)).toEqual([
      "pos.cashier_pin.set",
      "pos.cashier_pin.set",
    ]);
    expect(audit.rows.every((event) => event.correlation_id !== null)).toBe(
      true,
    );
  });
});
