import { randomUUID } from "node:crypto";

import { ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { DeviceManagementService } from "../src/device/device-management.service.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const devices = new DeviceManagementService(pool);
const suffix = randomUUID();
let companyId: string;
let branchId: string;
let actorUserId: string;

const publicKeyJwk = {
  crv: "P-256",
  kty: "EC",
  x: "A".repeat(43),
  y: "B".repeat(43),
};

beforeAll(async () => {
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Device service ${suffix}`],
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
       VALUES ('test', $1, 'Device test actor') RETURNING id`,
      [`device-${suffix}`],
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
    await client.query(
      "DELETE FROM platform.pos_device WHERE company_id = $1",
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

describe("DeviceManagementService", () => {
  it("registers a unique key once and records an audited status change", async () => {
    const context = { companyId, actorUserId };
    const registration = {
      displayName: "Till one",
      publicKeyJwk,
      appVersion: "1.0.0",
      localSchemaVersion: 1,
    };
    const registered = await devices.register(
      context,
      branchId,
      registration,
      `device-register-${suffix}`,
    );
    const retried = await devices.register(
      context,
      branchId,
      registration,
      `device-register-${suffix}`,
    );
    expect(registered).toEqual(retried);
    expect(registered.data).toMatchObject({
      branchId,
      status: "registered",
    });

    await expect(
      devices.register(
        context,
        branchId,
        { ...registration, displayName: "Duplicate key" },
        `device-duplicate-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const suspended = await devices.updateStatus(
      context,
      branchId,
      registered.data.id,
      {
        expectedUpdatedAt: registered.data.updatedAt,
        status: "suspended",
      },
      `device-suspend-${suffix}`,
    );
    expect(suspended.data).toMatchObject({
      id: registered.data.id,
      status: "suspended",
    });

    const [listed, audit] = await Promise.all([
      devices.list(context, branchId),
      pool.query<{ action: string; correlation_id: string | null }>(
        `SELECT action, correlation_id::text FROM audit.event
         WHERE company_id = $1 ORDER BY occurred_at`,
        [companyId],
      ),
    ]);
    expect(listed).toEqual([suspended.data]);
    expect(audit.rows.map((event) => event.action)).toEqual([
      "pos.device.registered",
      "pos.device.status_changed",
    ]);
    expect(audit.rows.every((event) => event.correlation_id !== null)).toBe(
      true,
    );
  });
});
