import { randomUUID } from "node:crypto";

import { ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PeriodManagementService } from "../src/accounting/period-management.service.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const periods = new PeriodManagementService(pool);
const suffix = randomUUID();
let companyId: string;
let actorUserId: string;

beforeAll(async () => {
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Period service ${suffix}`],
    )
  ).rows[0].id;
  actorUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
       (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Period test actor') RETURNING id`,
      [`period-${suffix}`],
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
      "DELETE FROM accounting.fiscal_period WHERE company_id = $1",
      [companyId],
    );
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

describe("PeriodManagementService", () => {
  it("creates and closes an unchanged empty fiscal period exactly once", async () => {
    const context = { companyId, actorUserId };
    const input = {
      name: "FY 2026",
      startsOn: "2026-01-01",
      endsOn: "2027-01-01",
    };
    const created = await periods.create(
      context,
      input,
      `period-create-${suffix}`,
    );
    const retriedCreate = await periods.create(
      context,
      input,
      `period-create-${suffix}`,
    );
    expect(created).toEqual(retriedCreate);
    expect(created.data.status).toBe("open");

    await expect(
      periods.create(
        context,
        { ...input, name: "Overlapping period" },
        `period-overlap-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const closed = await periods.close(
      context,
      created.data.id,
      { expectedUpdatedAt: created.data.updatedAt },
      `period-close-${suffix}`,
    );
    const retriedClose = await periods.close(
      context,
      created.data.id,
      { expectedUpdatedAt: created.data.updatedAt },
      `period-close-${suffix}`,
    );
    expect(closed).toEqual(retriedClose);
    expect(closed.data).toMatchObject({
      id: created.data.id,
      status: "closed",
      closedByUserId: actorUserId,
    });

    const [listed, audit] = await Promise.all([
      periods.list(context),
      pool.query<{ action: string; correlation_id: string | null }>(
        `SELECT action, correlation_id::text FROM audit.event
         WHERE company_id = $1 ORDER BY occurred_at`,
        [companyId],
      ),
    ]);
    expect(listed).toEqual([closed.data]);
    expect(audit.rows).toEqual([
      {
        action: "accounting.period.created",
        correlation_id: created.correlationId,
      },
      {
        action: "accounting.period.closed",
        correlation_id: closed.correlationId,
      },
    ]);
  });
});
