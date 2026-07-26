import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { AUTHORIZATION_POOL } from "../auth/authorization.service.js";

type Context = Readonly<{ companyId: string; actorUserId: string }>;
export type JournalLineInput = Readonly<{
  accountId: string;
  debitAmount: string;
  creditAmount: string;
  description?: string;
}>;
export type PostJournalInput = Readonly<{
  fiscalPeriodId: string;
  journalDate: string;
  description: string;
  lines: readonly JournalLineInput[];
}>;
export type JournalLine = Readonly<{
  id: string;
  lineNumber: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  debitAmount: string;
  creditAmount: string;
  description: string | null;
}>;
export type Journal = Readonly<{
  id: string;
  fiscalPeriodId: string;
  journalDate: string;
  description: string;
  status: "draft" | "posted";
  postedAt: string | null;
  lines: readonly JournalLine[];
}>;
type CommandResponse<T> = Readonly<{ data: T; correlationId: string }>;
type IdempotencyRow = Readonly<{
  is_new: boolean;
  response: CommandResponse<unknown> | null;
  correlation_id: string;
}>;
type JournalRow = Readonly<{
  id: string;
  fiscal_period_id: string;
  journal_date: string;
  description: string;
  status: Journal["status"];
  posted_at: string | null;
}>;
type JournalLineRow = Readonly<{
  id: string;
  line_number: number;
  account_id: string;
  account_code: string;
  account_name: string;
  debit_amount: string;
  credit_amount: string;
  description: string | null;
}>;

const journalColumns = `id, fiscal_period_id, journal_date::text, description, status,
  to_char(posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS posted_at`;

function canonicalJson(value: unknown): string {
  if (value === null || ["boolean", "number", "string"].includes(typeof value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Command payload contains a non-JSON value.");
}
function hash(value: unknown): Buffer {
  return createHash("sha256").update(canonicalJson(value)).digest();
}
function line(row: JournalLineRow): JournalLine {
  return {
    id: row.id,
    lineNumber: row.line_number,
    accountId: row.account_id,
    accountCode: row.account_code,
    accountName: row.account_name,
    debitAmount: row.debit_amount,
    creditAmount: row.credit_amount,
    description: row.description,
  };
}

@Injectable()
export class JournalManagementService {
  constructor(@Inject(AUTHORIZATION_POOL) private readonly pool: Pool) {}

  async list(context: Context): Promise<readonly Journal[]> {
    return this.withTenant(context, async (client) => {
      const journals = await client.query<JournalRow>(
        `SELECT ${journalColumns} FROM accounting.journal_entry
         WHERE status = 'posted' ORDER BY journal_date DESC, posted_at DESC`,
      );
      return Promise.all(
        journals.rows.map((journal) => this.journal(client, journal)),
      );
    });
  }

  async post(
    context: Context,
    input: PostJournalInput,
    key: string,
  ): Promise<CommandResponse<Journal>> {
    return this.command(
      context,
      "accounting.journal.post",
      key,
      input,
      async (client, correlationId) => {
        const created = await client.query<JournalRow>(
          `INSERT INTO accounting.journal_entry
             (company_id, fiscal_period_id, journal_date, description, created_by_user_id)
           VALUES ($1, $2, $3::date, $4, $5)
           RETURNING ${journalColumns}`,
          [
            context.companyId,
            input.fiscalPeriodId,
            input.journalDate,
            input.description,
            context.actorUserId,
          ],
        );
        const journal = created.rows[0];
        for (const [index, item] of input.lines.entries()) {
          await client.query(
            `INSERT INTO accounting.journal_line
               (company_id, journal_entry_id, account_id, line_number,
                debit_amount, credit_amount, description)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              context.companyId,
              journal.id,
              item.accountId,
              index + 1,
              item.debitAmount,
              item.creditAmount,
              item.description ?? null,
            ],
          );
        }
        await client.query("SELECT accounting.post_journal_entry($1)", [
          journal.id,
        ]);
        const data = await this.journal(client, journal);
        await this.audit(client, context.companyId, data.id, {
          fiscalPeriodId: data.fiscalPeriodId,
          lineCount: data.lines.length,
        });
        return { data, correlationId };
      },
    );
  }

  private async journal(client: PoolClient, row: JournalRow): Promise<Journal> {
    const lines = await client.query<JournalLineRow>(
      `SELECT line.id, line.line_number, line.account_id, account.code AS account_code,
              account.name AS account_name, line.debit_amount::text,
              line.credit_amount::text, line.description
       FROM accounting.journal_line AS line
       JOIN accounting.account AS account ON account.id = line.account_id
       WHERE line.journal_entry_id = $1 ORDER BY line.line_number`,
      [row.id],
    );
    const latest = await client.query<JournalRow>(
      `SELECT ${journalColumns} FROM accounting.journal_entry WHERE id = $1`,
      [row.id],
    );
    const current = latest.rows[0] ?? row;
    return {
      id: current.id,
      fiscalPeriodId: current.fiscal_period_id,
      journalDate: current.journal_date,
      description: current.description,
      status: current.status,
      postedAt: current.posted_at,
      lines: lines.rows.map(line),
    };
  }

  private async command<T>(
    context: Context,
    command: string,
    key: string,
    payload: unknown,
    operation: (
      client: PoolClient,
      correlationId: string,
    ) => Promise<CommandResponse<T>>,
  ): Promise<CommandResponse<T>> {
    return this.withTenant(context, async (client) => {
      const acquired = await client.query<IdempotencyRow>(
        "SELECT * FROM platform.acquire_command_idempotency($1, $2, $3, $4)",
        [command, key, hash(payload), randomUUID()],
      );
      const record = acquired.rows[0];
      if (!record.is_new && record.response)
        return record.response as CommandResponse<T>;
      if (!record.is_new)
        throw new ConflictException("The command is still being processed.");
      await client.query(
        "SELECT set_config('app.current_correlation_id', $1, true)",
        [record.correlation_id],
      );
      const response = await operation(client, record.correlation_id);
      await client.query(
        "SELECT platform.complete_command_idempotency($1, $2, $3)",
        [command, key, response],
      );
      return response;
    });
  }

  private async audit(
    client: PoolClient,
    companyId: string,
    journalId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await client.query("SELECT audit.write_event($1, $2, $3, $4, $5)", [
      companyId,
      "accounting.journal.posted",
      "accounting.journal_entry",
      journalId,
      metadata,
    ]);
  }

  private async withTenant<T>(
    context: Context,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_company_id', $1, true)",
        [context.companyId],
      );
      await client.query(
        "SELECT set_config('app.current_actor_id', $1, true)",
        [context.actorUserId],
      );
      await client.query("SET LOCAL ROLE ledgerlite_app");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      const message =
        typeof error === "object" && error !== null
          ? (error as { message?: string }).message
          : undefined;
      if (
        message?.includes("journal entry is not balanced") ||
        message?.includes("journal entry fiscal period is not open") ||
        message?.includes("journal date is outside its fiscal period") ||
        message?.includes("inactive or non-posting account")
      )
        throw new BadRequestException(message);
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "23505"
      )
        throw new ConflictException("A record with that value already exists.");
      if (message?.includes("idempotency key"))
        throw new ConflictException(
          "Idempotency-Key was already used for a different request.",
        );
      throw error;
    } finally {
      client.release();
    }
  }
}
