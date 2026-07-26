import { randomUUID } from "node:crypto";

import { ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { ChartManagementService } from "../src/accounting/chart-management.service.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const charts = new ChartManagementService(pool);
const suffix = randomUUID();
let companyId: string;
let actorUserId: string;

beforeAll(async () => {
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Chart service ${suffix}`],
    )
  ).rows[0].id;
  actorUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
       (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Chart test actor') RETURNING id`,
      [`chart-${suffix}`],
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
    await client.query("DELETE FROM accounting.account WHERE company_id = $1", [
      companyId,
    ]);
    await client.query(
      "DELETE FROM accounting.chart_of_accounts WHERE company_id = $1",
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

describe("ChartManagementService", () => {
  it("creates a retry-safe UAE starter chart and allows an additional account", async () => {
    const context = { companyId, actorUserId };
    const created = await charts.createStarter(
      context,
      { name: "UAE retail starter chart" },
      `chart-starter-${suffix}`,
    );
    const retried = await charts.createStarter(
      context,
      { name: "UAE retail starter chart" },
      `chart-starter-${suffix}`,
    );
    expect(created).toEqual(retried);
    expect(created.data.accounts).toHaveLength(11);
    expect(created.data.accounts).toContainEqual(
      expect.objectContaining({ code: "2000", name: "VAT payable" }),
    );

    const account = await charts.createAccount(
      context,
      {
        code: "6100",
        name: "Rent expense",
        accountType: "expense",
        isPosting: true,
      },
      `chart-account-${suffix}`,
    );
    expect(account.data).toMatchObject({
      code: "6100",
      normalBalance: "debit",
    });
    await expect(
      charts.createStarter(
        context,
        { name: "Another chart" },
        `chart-duplicate-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const [active, audit] = await Promise.all([
      charts.activeChart(context),
      pool.query<{ action: string; correlation_id: string | null }>(
        `SELECT action, correlation_id::text FROM audit.event
         WHERE company_id = $1 ORDER BY occurred_at`,
        [companyId],
      ),
    ]);
    expect(active?.accounts).toHaveLength(12);
    expect(audit.rows.map((event) => event.action)).toEqual([
      "accounting.chart.created",
      "accounting.account.created",
    ]);
    expect(audit.rows.every((event) => event.correlation_id !== null)).toBe(
      true,
    );
  });
});
