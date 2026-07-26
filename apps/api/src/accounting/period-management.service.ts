import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { AUTHORIZATION_POOL } from "../auth/authorization.service.js";

type Context = Readonly<{ companyId: string; actorUserId: string }>;
export type FiscalPeriod = Readonly<{
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: "open" | "closing" | "closed";
  closedAt: string | null;
  closedByUserId: string | null;
  updatedAt: string;
}>;
export type CreateFiscalPeriodInput = Readonly<{
  name: string;
  startsOn: string;
  endsOn: string;
}>;
export type CloseFiscalPeriodInput = Readonly<{ expectedUpdatedAt: string }>;
type CommandResponse<T> = Readonly<{ data: T; correlationId: string }>;
type IdempotencyRow = Readonly<{
  is_new: boolean;
  response: CommandResponse<unknown> | null;
  correlation_id: string;
}>;
type PeriodRow = Readonly<{
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: FiscalPeriod["status"];
  closed_at: string | null;
  closed_by_user_id: string | null;
  updated_at: string;
}>;

const periodColumns = `id, name, starts_on::text, ends_on::text, status,
  to_char(closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS closed_at,
  closed_by_user_id,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;

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
function fiscalPeriod(row: PeriodRow): FiscalPeriod {
  return {
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
    closedAt: row.closed_at,
    closedByUserId: row.closed_by_user_id,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class PeriodManagementService {
  constructor(@Inject(AUTHORIZATION_POOL) private readonly pool: Pool) {}

  async list(context: Context): Promise<readonly FiscalPeriod[]> {
    return this.withTenant(context, async (client) => {
      const periods = await client.query<PeriodRow>(
        `SELECT ${periodColumns} FROM accounting.fiscal_period
         ORDER BY starts_on DESC`,
      );
      return periods.rows.map(fiscalPeriod);
    });
  }

  async create(
    context: Context,
    input: CreateFiscalPeriodInput,
    key: string,
  ): Promise<CommandResponse<FiscalPeriod>> {
    return this.command(
      context,
      "accounting.period.create",
      key,
      input,
      async (client, correlationId) => {
        const created = await client.query<PeriodRow>(
          `INSERT INTO accounting.fiscal_period
             (company_id, name, starts_on, ends_on)
           VALUES ($1, $2, $3::date, $4::date)
           RETURNING ${periodColumns}`,
          [context.companyId, input.name, input.startsOn, input.endsOn],
        );
        const data = fiscalPeriod(created.rows[0]);
        await this.audit(
          client,
          context.companyId,
          "accounting.period.created",
          data.id,
          {
            endsOn: data.endsOn,
            startsOn: data.startsOn,
          },
        );
        return { data, correlationId };
      },
    );
  }

  async close(
    context: Context,
    periodId: string,
    input: CloseFiscalPeriodInput,
    key: string,
  ): Promise<CommandResponse<FiscalPeriod>> {
    return this.command(
      context,
      "accounting.period.close",
      key,
      input,
      async (client, correlationId) => {
        await client.query(
          "SELECT accounting.close_fiscal_period($1, $2::timestamptz, $3)",
          [periodId, input.expectedUpdatedAt, context.actorUserId],
        );
        const closed = await client.query<PeriodRow>(
          `SELECT ${periodColumns} FROM accounting.fiscal_period WHERE id = $1`,
          [periodId],
        );
        if (closed.rowCount !== 1)
          throw new NotFoundException("Fiscal period was not found.");
        const data = fiscalPeriod(closed.rows[0]);
        await this.audit(
          client,
          context.companyId,
          "accounting.period.closed",
          data.id,
          {
            endsOn: data.endsOn,
            startsOn: data.startsOn,
          },
        );
        return { data, correlationId };
      },
    );
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
    periodId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await client.query("SELECT audit.write_event($1, $2, $3, $4, $5)", [
      companyId,
      action,
      "accounting.fiscal_period",
      periodId,
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
      if (message?.includes("was changed by another user"))
        throw new ConflictException(
          "Fiscal period was changed by another user. Refresh and try again.",
        );
      if (
        message?.includes("contains draft journals") ||
        message?.includes("fiscal period is not open")
      )
        throw new ConflictException(message);
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "23P01"
      )
        throw new ConflictException("Fiscal periods must not overlap.");
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
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "23514"
      )
        throw new BadRequestException("Fiscal period dates are invalid.");
      throw error;
    } finally {
      client.release();
    }
  }
}
