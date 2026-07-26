import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { AUTHORIZATION_POOL } from "../auth/authorization.service.js";

export type JsonObject = Readonly<Record<string, unknown>>;
export type CompanyProfile = Readonly<{
  id: string;
  legalName: string;
  tradeName: string | null;
  trn: string | null;
  baseCurrency: string;
  timeZone: string;
  fiscalYearStartMonth: number;
  status: "active" | "suspended" | "closed";
  createdAt: string;
  updatedAt: string;
}>;
export type BranchProfile = Readonly<{
  id: string;
  companyId: string;
  code: string;
  name: string;
  address: JsonObject;
  timeZone: string;
  status: "active" | "inactive" | "closed";
  createdAt: string;
  updatedAt: string;
}>;
export type UpdateCompanyInput = Readonly<{
  expectedUpdatedAt: string;
  legalName?: string;
  tradeName?: string | null;
  trn?: string | null;
  baseCurrency?: string;
  timeZone?: string;
  fiscalYearStartMonth?: number;
}>;
export type CreateBranchInput = Readonly<{
  code: string;
  name: string;
  address: JsonObject;
  timeZone: string;
  status: "active" | "inactive";
}>;
export type UpdateBranchInput = Readonly<{
  expectedUpdatedAt: string;
  code?: string;
  name?: string;
  address?: JsonObject;
  timeZone?: string;
  status?: "active" | "inactive";
}>;
export type CommandResponse<T> = Readonly<{ data: T; correlationId: string }>;
type TenantActorContext = Readonly<{ companyId: string; actorUserId: string }>;
type CompanyRow = Readonly<{
  id: string;
  legal_name: string;
  trade_name: string | null;
  trn: string | null;
  base_currency: string;
  time_zone: string;
  fiscal_year_start_month: number;
  status: CompanyProfile["status"];
  created_at: string;
  updated_at: string;
}>;
type BranchRow = Readonly<{
  id: string;
  company_id: string;
  code: string;
  name: string;
  address: JsonObject;
  time_zone: string;
  status: BranchProfile["status"];
  created_at: string;
  updated_at: string;
}>;
type IdempotencyRow = Readonly<{
  is_new: boolean;
  response: CommandResponse<unknown> | null;
  correlation_id: string;
}>;

const companyColumns = `id, legal_name, trade_name, trn, base_currency, time_zone,
  fiscal_year_start_month, status,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;
const branchColumns = `id, company_id, code, name, address, time_zone, status,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;

function companyProfile(row: CompanyRow): CompanyProfile {
  return {
    id: row.id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    trn: row.trn,
    baseCurrency: row.base_currency,
    timeZone: row.time_zone,
    fiscalYearStartMonth: row.fiscal_year_start_month,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function branchProfile(row: BranchRow): BranchProfile {
  return {
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    name: row.name,
    address: row.address,
    timeZone: row.time_zone,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function canonicalJson(value: unknown): string {
  if (value === null || ["boolean", "number", "string"].includes(typeof value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`)
      .join(",")}}`;
  }
  throw new Error("Command payload contains a non-JSON value.");
}
function requestHash(value: unknown): Buffer {
  return createHash("sha256").update(canonicalJson(value)).digest();
}
function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}
function databaseErrorMessage(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : undefined;
}

@Injectable()
export class CompanyBranchService {
  constructor(@Inject(AUTHORIZATION_POOL) private readonly pool: Pool) {}

  async getCompany(context: TenantActorContext): Promise<CompanyProfile> {
    return this.withTenantContext(context, async (client) => {
      const result = await client.query<CompanyRow>(
        `SELECT ${companyColumns} FROM platform.company WHERE id = $1`,
        [context.companyId],
      );
      if (result.rowCount !== 1)
        throw new NotFoundException("Company was not found.");
      return companyProfile(result.rows[0]);
    });
  }

  async updateCompany(
    context: TenantActorContext,
    input: UpdateCompanyInput,
    idempotencyKey: string,
  ): Promise<CommandResponse<CompanyProfile>> {
    return this.executeCommand(
      context,
      "company.update",
      idempotencyKey,
      input,
      async (client, correlationId) => {
        const values: unknown[] = [];
        const assignments: string[] = [];
        const fields: ReadonlyArray<
          readonly [
            keyof Pick<
              UpdateCompanyInput,
              | "legalName"
              | "tradeName"
              | "trn"
              | "baseCurrency"
              | "timeZone"
              | "fiscalYearStartMonth"
            >,
            string,
          ]
        > = [
          ["legalName", "legal_name"],
          ["tradeName", "trade_name"],
          ["trn", "trn"],
          ["baseCurrency", "base_currency"],
          ["timeZone", "time_zone"],
          ["fiscalYearStartMonth", "fiscal_year_start_month"],
        ];
        for (const [property, column] of fields) {
          const value = input[property];
          if (value !== undefined) {
            values.push(value);
            assignments.push(`${column} = $${values.length}`);
          }
        }
        values.push(context.companyId, input.expectedUpdatedAt);
        const result = await client.query<CompanyRow>(
          `UPDATE platform.company SET ${assignments.join(", ")}
        WHERE id = $${values.length - 1} AND updated_at = $${values.length}::timestamptz RETURNING ${companyColumns}`,
          values,
        );
        if (result.rowCount !== 1) {
          await this.assertCompanyExists(client, context.companyId);
          throw new ConflictException(
            "Company was changed by another user. Refresh and try again.",
          );
        }
        const company = companyProfile(result.rows[0]);
        await this.writeAuditEvent(client, {
          action: "company.updated",
          companyId: context.companyId,
          entityId: company.id,
          entityType: "platform.company",
          metadata: {
            changedFields: assignments.map(
              (assignment) => assignment.split(" ")[0],
            ),
          },
        });
        return { data: company, correlationId };
      },
    );
  }

  async listBranches(
    context: TenantActorContext,
  ): Promise<readonly BranchProfile[]> {
    return this.withTenantContext(context, async (client) =>
      (
        await client.query<BranchRow>(
          `SELECT ${branchColumns} FROM platform.branch ORDER BY code`,
        )
      ).rows.map(branchProfile),
    );
  }
  async getBranch(
    context: TenantActorContext,
    branchId: string,
  ): Promise<BranchProfile> {
    return this.withTenantContext(context, async (client) => {
      const result = await client.query<BranchRow>(
        `SELECT ${branchColumns} FROM platform.branch WHERE id = $1`,
        [branchId],
      );
      if (result.rowCount !== 1)
        throw new NotFoundException("Branch was not found.");
      return branchProfile(result.rows[0]);
    });
  }
  async createBranch(
    context: TenantActorContext,
    input: CreateBranchInput,
    idempotencyKey: string,
  ): Promise<CommandResponse<BranchProfile>> {
    return this.executeCommand(
      context,
      "branch.create",
      idempotencyKey,
      input,
      async (client, correlationId) => {
        const result = await client.query<BranchRow>(
          `INSERT INTO platform.branch (company_id, code, name, address, time_zone, status)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING ${branchColumns}`,
          [
            context.companyId,
            input.code,
            input.name,
            input.address,
            input.timeZone,
            input.status,
          ],
        );
        const branch = branchProfile(result.rows[0]);
        await this.writeAuditEvent(client, {
          action: "branch.created",
          companyId: context.companyId,
          entityId: branch.id,
          entityType: "platform.branch",
          metadata: { code: branch.code, status: branch.status },
        });
        return { data: branch, correlationId };
      },
    );
  }
  async updateBranch(
    context: TenantActorContext,
    branchId: string,
    input: UpdateBranchInput,
    idempotencyKey: string,
  ): Promise<CommandResponse<BranchProfile>> {
    return this.executeCommand(
      context,
      "branch.update",
      idempotencyKey,
      input,
      async (client, correlationId) => {
        const branchStatus = await client.query<{
          status: BranchProfile["status"];
        }>("SELECT status FROM platform.branch WHERE id = $1 FOR KEY SHARE", [
          branchId,
        ]);
        if (branchStatus.rowCount !== 1)
          throw new NotFoundException("Branch was not found.");
        if (branchStatus.rows[0].status === "closed")
          throw new ConflictException(
            "A closed branch cannot be changed in this release.",
          );
        const values: unknown[] = [];
        const assignments: string[] = [];
        const fields: ReadonlyArray<
          readonly [
            keyof Pick<
              UpdateBranchInput,
              "code" | "name" | "address" | "timeZone" | "status"
            >,
            string,
            boolean?,
          ]
        > = [
          ["code", "code"],
          ["name", "name"],
          ["address", "address", true],
          ["timeZone", "time_zone"],
          ["status", "status"],
        ];
        for (const [property, column, asJson] of fields) {
          const value = input[property];
          if (value !== undefined) {
            values.push(value);
            assignments.push(
              `${column} = $${values.length}${asJson ? "::jsonb" : ""}`,
            );
          }
        }
        values.push(branchId, input.expectedUpdatedAt);
        const result = await client.query<BranchRow>(
          `UPDATE platform.branch SET ${assignments.join(", ")}
        WHERE id = $${values.length - 1} AND updated_at = $${values.length}::timestamptz RETURNING ${branchColumns}`,
          values,
        );
        if (result.rowCount !== 1)
          throw new ConflictException(
            "Branch was changed by another user. Refresh and try again.",
          );
        const branch = branchProfile(result.rows[0]);
        await this.writeAuditEvent(client, {
          action: "branch.updated",
          companyId: context.companyId,
          entityId: branch.id,
          entityType: "platform.branch",
          metadata: {
            changedFields: assignments.map(
              (assignment) => assignment.split(" ")[0],
            ),
          },
        });
        return { data: branch, correlationId };
      },
    );
  }

  private async executeCommand<T>(
    context: TenantActorContext,
    command: string,
    idempotencyKey: string,
    payload: unknown,
    operation: (
      client: PoolClient,
      correlationId: string,
    ) => Promise<CommandResponse<T>>,
  ): Promise<CommandResponse<T>> {
    return this.withTenantContext(context, async (client) => {
      const acquired = await client.query<IdempotencyRow>(
        "SELECT * FROM platform.acquire_command_idempotency($1, $2, $3, $4)",
        [command, idempotencyKey, requestHash(payload), randomUUID()],
      );
      const record = acquired.rows[0];
      if (!record.is_new && record.response)
        return record.response as CommandResponse<T>;
      if (!record.is_new)
        throw new ConflictException("The command is still being processed.");
      const response = await operation(client, record.correlation_id);
      await client.query(
        "SELECT platform.complete_command_idempotency($1, $2, $3)",
        [command, idempotencyKey, response],
      );
      return response;
    });
  }
  private async assertCompanyExists(
    client: PoolClient,
    companyId: string,
  ): Promise<void> {
    if (
      (
        await client.query("SELECT id FROM platform.company WHERE id = $1", [
          companyId,
        ])
      ).rowCount !== 1
    )
      throw new NotFoundException("Company was not found.");
  }
  private async writeAuditEvent(
    client: PoolClient,
    event: Readonly<{
      companyId: string;
      action: string;
      entityType: string;
      entityId: string;
      metadata: JsonObject;
    }>,
  ): Promise<void> {
    await client.query("SELECT audit.write_event($1, $2, $3, $4, $5)", [
      event.companyId,
      event.action,
      event.entityType,
      event.entityId,
      event.metadata,
    ]);
  }
  private async withTenantContext<T>(
    context: TenantActorContext,
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
      throw this.toHttpException(error);
    } finally {
      client.release();
    }
  }
  private toHttpException(error: unknown): unknown {
    if (error instanceof HttpException) return error;
    if (databaseErrorCode(error) === "23505")
      return new ConflictException("A record with that value already exists.");
    if (
      databaseErrorCode(error) === "22023" &&
      databaseErrorMessage(error)?.includes("idempotency key")
    )
      return new ConflictException(
        "Idempotency-Key was already used for a different request.",
      );
    if (databaseErrorCode(error) === "22023")
      return new BadRequestException("The command request is invalid.");
    return error;
  }
}
