import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const suffix = randomUUID();
let companyId: string;
let actorUserId: string;

async function asCompany<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.current_company_id', $1, true)",
      [companyId],
    );
    await client.query("SELECT set_config('app.current_actor_id', $1, true)", [
      actorUserId,
    ]);
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

async function insertBalancedDraft(client: PoolClient) {
  const chartId = (
    await client.query<{ id: string }>(
      `INSERT INTO accounting.chart_of_accounts
       (company_id, name, version, effective_from)
       VALUES ($1, 'UAE retail starter', 1, '2026-01-01') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  const accounts = await client.query<{ id: string; code: string }>(
    `INSERT INTO accounting.account
       (company_id, chart_id, code, name, account_type, normal_balance)
     VALUES
       ($1, $2, '1000', 'Cash on hand', 'asset', 'debit'),
       ($1, $2, '4000', 'Retail sales', 'revenue', 'credit')
     RETURNING id, code`,
    [companyId, chartId],
  );
  const periodId = (
    await client.query<{ id: string }>(
      `INSERT INTO accounting.fiscal_period
       (company_id, name, starts_on, ends_on)
       VALUES ($1, 'FY26', '2026-01-01', '2027-01-01') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  const entryId = (
    await client.query<{ id: string }>(
      `INSERT INTO accounting.journal_entry
       (company_id, fiscal_period_id, journal_date, description, created_by_user_id)
       VALUES ($1, $2, '2026-07-26', 'Cash sale', $3) RETURNING id`,
      [companyId, periodId, actorUserId],
    )
  ).rows[0].id;
  await client.query(
    `INSERT INTO accounting.journal_line
       (company_id, journal_entry_id, account_id, line_number, debit_amount, credit_amount)
     VALUES
       ($1, $2, $3, 1, 10, 0),
       ($1, $2, $4, 2, 0, 10)`,
    [companyId, entryId, accounts.rows[0].id, accounts.rows[1].id],
  );
  return {
    entryId,
    periodId,
    cashAccountId: accounts.rows[0].id,
    salesAccountId: accounts.rows[1].id,
  };
}

beforeAll(async () => {
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Accounting core ${suffix}`],
    )
  ).rows[0].id;
  actorUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
       (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Accounting test actor') RETURNING id`,
      [`accounting-${suffix}`],
    )
  ).rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM platform.app_user WHERE id = $1", [
    actorUserId,
  ]);
  await pool.query("DELETE FROM platform.company WHERE id = $1", [companyId]);
  await pool.end();
});

describe("accounting core database invariants", () => {
  it("forces tenant row security on all accounting core tables", async () => {
    const result = await pool.query<{ relforcerowsecurity: boolean }>(
      `SELECT relforcerowsecurity
       FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
       WHERE nspname = 'accounting'
         AND relname IN ('chart_of_accounts', 'account', 'fiscal_period', 'journal_entry', 'journal_line')`,
    );
    expect(result.rows).toHaveLength(5);
    expect(result.rows.every((row) => row.relforcerowsecurity)).toBe(true);
  });

  it("posts only balanced open-period drafts and makes the result immutable", async () => {
    await asCompany(async (client) => {
      const { entryId } = await insertBalancedDraft(client);
      const posted = await client.query<{ posted_at: Date }>(
        "SELECT accounting.post_journal_entry($1) AS posted_at",
        [entryId],
      );
      expect(posted.rows[0].posted_at).toBeInstanceOf(Date);
      const entry = await client.query<{
        status: string;
        posted_at: Date | null;
      }>(
        "SELECT status, posted_at FROM accounting.journal_entry WHERE id = $1",
        [entryId],
      );
      expect(entry.rows).toEqual([
        { status: "posted", posted_at: expect.any(Date) },
      ]);

      await client.query("SAVEPOINT immutable_entry");
      await expect(
        client.query(
          "UPDATE accounting.journal_entry SET description = 'Changed' WHERE id = $1",
          [entryId],
        ),
      ).rejects.toThrow(/immutable/i);
      await client.query("ROLLBACK TO SAVEPOINT immutable_entry");

      await client.query("SAVEPOINT immutable_line");
      await expect(
        client.query(
          "DELETE FROM accounting.journal_line WHERE journal_entry_id = $1",
          [entryId],
        ),
      ).rejects.toThrow(/immutable/i);
      await client.query("ROLLBACK TO SAVEPOINT immutable_line");
    });
  });

  it("rejects an unbalanced draft and a closed period", async () => {
    await asCompany(async (client) => {
      const { entryId, periodId, cashAccountId, salesAccountId } =
        await insertBalancedDraft(client);
      await client.query(
        `UPDATE accounting.journal_line
         SET credit_amount = 9 WHERE journal_entry_id = $1 AND line_number = 2`,
        [entryId],
      );
      await client.query("SAVEPOINT unbalanced_post");
      await expect(
        client.query("SELECT accounting.post_journal_entry($1)", [entryId]),
      ).rejects.toThrow(/not balanced/i);
      await client.query("ROLLBACK TO SAVEPOINT unbalanced_post");
      await client.query("DELETE FROM accounting.journal_entry WHERE id = $1", [
        entryId,
      ]);
      const period = await client.query<{ updated_at: string }>(
        `SELECT to_char(updated_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
         FROM accounting.fiscal_period WHERE id = $1`,
        [periodId],
      );
      await client.query("SELECT accounting.close_fiscal_period($1, $2, $3)", [
        periodId,
        period.rows[0].updated_at,
        actorUserId,
      ]);
      const closedEntryId = (
        await client.query<{ id: string }>(
          `INSERT INTO accounting.journal_entry
             (company_id, fiscal_period_id, journal_date, description, created_by_user_id)
           VALUES ($1, $2, '2026-07-26', 'Closed period test', $3) RETURNING id`,
          [companyId, periodId, actorUserId],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO accounting.journal_line
           (company_id, journal_entry_id, account_id, line_number, debit_amount, credit_amount)
         VALUES
           ($1, $2, $3, 1, 10, 0),
           ($1, $2, $4, 2, 0, 10)`,
        [companyId, closedEntryId, cashAccountId, salesAccountId],
      );
      await expect(
        client.query("SELECT accounting.post_journal_entry($1)", [
          closedEntryId,
        ]),
      ).rejects.toThrow(/not open/i);
    });
  });

  it("allows multiple manual drafts while retaining unique system sources", async () => {
    await asCompany(async (client) => {
      const { periodId } = await insertBalancedDraft(client);
      await expect(
        client.query(
          `INSERT INTO accounting.journal_entry
           (company_id, fiscal_period_id, journal_date, description, created_by_user_id)
           VALUES ($1, $2, '2026-07-26', 'Second manual journal', $3)`,
          [companyId, periodId, actorUserId],
        ),
      ).resolves.toBeDefined();
    });
  });
});
