import { createHash, randomUUID } from "node:crypto";

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { AUTHORIZATION_POOL } from "../auth/authorization.service.js";

type Context = Readonly<{ companyId: string; actorUserId: string }>;
type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
type NormalBalance = "debit" | "credit";
export type Account = Readonly<{
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  parentAccountId: string | null;
  isPosting: boolean;
  isActive: boolean;
}>;
export type Chart = Readonly<{
  id: string;
  name: string;
  version: number;
  effectiveFrom: string;
  accounts: readonly Account[];
}>;
export type CreateStarterChartInput = Readonly<{ name: string }>;
export type CreateAccountInput = Readonly<{
  code: string;
  name: string;
  accountType: AccountType;
  parentAccountId?: string;
  isPosting: boolean;
}>;
type CommandResponse<T> = Readonly<{ data: T; correlationId: string }>;
type IdempotencyRow = Readonly<{
  is_new: boolean;
  response: CommandResponse<unknown> | null;
  correlation_id: string;
}>;
type ChartRow = Readonly<{
  id: string;
  name: string;
  version: number;
  effective_from: string;
}>;
type AccountRow = Readonly<{
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  normal_balance: NormalBalance;
  parent_account_id: string | null;
  is_posting: boolean;
  is_active: boolean;
}>;

const accountColumns = `id, code, name, account_type, normal_balance,
  parent_account_id, is_posting, is_active`;
const starterAccounts: ReadonlyArray<
  readonly [string, string, AccountType, NormalBalance]
> = [
  ["1000", "Cash on hand", "asset", "debit"],
  ["1010", "Card payment clearing", "asset", "debit"],
  ["1020", "Bank", "asset", "debit"],
  ["1200", "Inventory asset", "asset", "debit"],
  ["1300", "VAT receivable", "asset", "debit"],
  ["2000", "VAT payable", "liability", "credit"],
  ["3000", "Owner capital", "equity", "credit"],
  ["4000", "Retail sales", "revenue", "credit"],
  ["4100", "Cash overage income", "revenue", "credit"],
  ["5000", "Cost of goods sold", "expense", "debit"],
  ["5100", "Cash shortage expense", "expense", "debit"],
];

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
function account(row: AccountRow): Account {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    accountType: row.account_type,
    normalBalance: row.normal_balance,
    parentAccountId: row.parent_account_id,
    isPosting: row.is_posting,
    isActive: row.is_active,
  };
}
function normalBalance(accountType: AccountType): NormalBalance {
  return accountType === "asset" || accountType === "expense"
    ? "debit"
    : "credit";
}

@Injectable()
export class ChartManagementService {
  constructor(@Inject(AUTHORIZATION_POOL) private readonly pool: Pool) {}

  async activeChart(context: Context): Promise<Chart | null> {
    return this.withTenant(context, async (client) => {
      const chart = await client.query<ChartRow>(
        `SELECT id, name, version, effective_from::text
         FROM accounting.chart_of_accounts WHERE status = 'active'`,
      );
      if (chart.rowCount === 0) return null;
      return this.chart(client, chart.rows[0]);
    });
  }

  async createStarter(
    context: Context,
    input: CreateStarterChartInput,
    key: string,
  ): Promise<CommandResponse<Chart>> {
    return this.command(
      context,
      "accounting.chart.starter.create",
      key,
      input,
      async (client, correlationId) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `${context.companyId}:accounting-chart`,
        ]);
        const active = await client.query(
          "SELECT id FROM accounting.chart_of_accounts WHERE status = 'active'",
        );
        if (active.rowCount !== 0)
          throw new ConflictException("An active chart already exists.");
        const created = await client.query<ChartRow>(
          `INSERT INTO accounting.chart_of_accounts
             (company_id, name, version)
           VALUES ($1, $2, 1) RETURNING id, name, version, effective_from::text`,
          [context.companyId, input.name],
        );
        const chart = created.rows[0];
        for (const [code, name, accountType, balance] of starterAccounts) {
          await client.query(
            `INSERT INTO accounting.account
               (company_id, chart_id, code, name, account_type, normal_balance)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [context.companyId, chart.id, code, name, accountType, balance],
          );
        }
        const data = await this.chart(client, chart);
        await this.audit(
          client,
          context.companyId,
          "accounting.chart.created",
          data.id,
          { accountCount: data.accounts.length, version: data.version },
        );
        return { data, correlationId };
      },
    );
  }

  async createAccount(
    context: Context,
    input: CreateAccountInput,
    key: string,
  ): Promise<CommandResponse<Account>> {
    return this.command(
      context,
      "accounting.account.create",
      key,
      input,
      async (client, correlationId) => {
        const active = await client.query<ChartRow>(
          `SELECT id, name, version, effective_from::text
           FROM accounting.chart_of_accounts WHERE status = 'active'`,
        );
        if (active.rowCount !== 1)
          throw new ConflictException("An active chart is required first.");
        const created = await client.query<AccountRow>(
          `INSERT INTO accounting.account
             (company_id, chart_id, code, name, account_type, normal_balance,
              parent_account_id, is_posting)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING ${accountColumns}`,
          [
            context.companyId,
            active.rows[0].id,
            input.code,
            input.name,
            input.accountType,
            normalBalance(input.accountType),
            input.parentAccountId ?? null,
            input.isPosting,
          ],
        );
        const data = account(created.rows[0]);
        await this.audit(
          client,
          context.companyId,
          "accounting.account.created",
          data.id,
          { accountType: data.accountType, code: data.code },
        );
        return { data, correlationId };
      },
    );
  }

  private async chart(client: PoolClient, row: ChartRow): Promise<Chart> {
    const accounts = await client.query<AccountRow>(
      `SELECT ${accountColumns} FROM accounting.account
       WHERE chart_id = $1 ORDER BY code`,
      [row.id],
    );
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      effectiveFrom: row.effective_from,
      accounts: accounts.rows.map(account),
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
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await client.query("SELECT audit.write_event($1, $2, $3, $4, $5)", [
      companyId,
      action,
      "accounting.chart_or_account",
      entityId,
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
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "23505"
      )
        throw new ConflictException("A record with that value already exists.");
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { message?: string }).message?.includes("idempotency key")
      )
        throw new ConflictException(
          "Idempotency-Key was already used for a different request.",
        );
      throw error;
    } finally {
      client.release();
    }
  }
}
