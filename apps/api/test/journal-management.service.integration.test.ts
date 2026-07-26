import { randomUUID } from "node:crypto";

import { BadRequestException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { JournalManagementService } from "../src/accounting/journal-management.service.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const journals = new JournalManagementService(pool);
const suffix = randomUUID();
let companyId: string;
let actorUserId: string;
let periodId: string;
let cashAccountId: string;
let salesAccountId: string;

beforeAll(async () => {
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Journal service ${suffix}`],
    )
  ).rows[0].id;
  actorUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
       (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Journal test actor') RETURNING id`,
      [`journal-${suffix}`],
    )
  ).rows[0].id;
  const chartId = (
    await pool.query<{ id: string }>(
      `INSERT INTO accounting.chart_of_accounts
       (company_id, name, version, effective_from)
       VALUES ($1, 'Test chart', 1, '2026-01-01') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  const accounts = await pool.query<{ id: string; code: string }>(
    `INSERT INTO accounting.account
       (company_id, chart_id, code, name, account_type, normal_balance)
     VALUES
       ($1, $2, '1000', 'Cash', 'asset', 'debit'),
       ($1, $2, '4000', 'Sales', 'revenue', 'credit')
     RETURNING id, code`,
    [companyId, chartId],
  );
  cashAccountId = accounts.rows.find((account) => account.code === "1000")!.id;
  salesAccountId = accounts.rows.find((account) => account.code === "4000")!.id;
  periodId = (
    await pool.query<{ id: string }>(
      `INSERT INTO accounting.fiscal_period
       (company_id, name, starts_on, ends_on)
       VALUES ($1, 'FY26', '2026-01-01', '2027-01-01') RETURNING id`,
      [companyId],
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
      "DELETE FROM accounting.journal_line WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM accounting.journal_entry WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM accounting.fiscal_period WHERE company_id = $1",
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

describe("JournalManagementService", () => {
  it("posts a manual journal once with immutable balanced lines", async () => {
    const context = { companyId, actorUserId };
    const input = {
      fiscalPeriodId: periodId,
      journalDate: "2026-07-26",
      description: "Cash sale correction",
      lines: [
        { accountId: cashAccountId, debitAmount: "10", creditAmount: "0" },
        { accountId: salesAccountId, debitAmount: "0", creditAmount: "10" },
      ],
    };
    const posted = await journals.post(
      context,
      input,
      `journal-post-${suffix}`,
    );
    const retried = await journals.post(
      context,
      input,
      `journal-post-${suffix}`,
    );
    expect(posted).toEqual(retried);
    expect(posted.data).toMatchObject({
      fiscalPeriodId: periodId,
      status: "posted",
      lines: [
        expect.objectContaining({ debitAmount: "10.000000" }),
        expect.objectContaining({ creditAmount: "10.000000" }),
      ],
    });

    await expect(
      journals.post(
        context,
        {
          ...input,
          lines: [input.lines[0], { ...input.lines[1], creditAmount: "9" }],
        },
        `journal-unbalanced-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const [listed, audit] = await Promise.all([
      journals.list(context),
      pool.query<{ action: string; correlation_id: string | null }>(
        `SELECT action, correlation_id::text FROM audit.event
         WHERE company_id = $1 ORDER BY occurred_at`,
        [companyId],
      ),
    ]);
    expect(listed).toEqual([posted.data]);
    expect(audit.rows).toEqual([
      {
        action: "accounting.journal.posted",
        correlation_id: posted.correlationId,
      },
    ]);
  });
});
