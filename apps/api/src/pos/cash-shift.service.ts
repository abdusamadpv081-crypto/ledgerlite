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
type ShiftPolicy = Readonly<{ id: string; version: number }>;
type IdempotencyRow = Readonly<{
  correlation_id: string;
  is_new: boolean;
  response: CommandResponse<unknown> | null;
}>;
type ShiftRow = Readonly<{
  id: string;
  branch_id: string;
  device_id: string;
  cashier_user_id: string;
  status: CashShiftProfile["status"];
  currency_code: string;
  opening_float: string;
  policy_id: string;
  policy_version: number;
  opened_at: string;
}>;
export type CommandResponse<T> = Readonly<{
  correlationId: string;
  data: T;
}>;
export type OpenCashShiftInput = Readonly<{
  deviceId: string;
  openingFloat: string;
}>;
export type CashShiftProfile = Readonly<{
  id: string;
  branchId: string;
  deviceId: string;
  cashierUserId: string;
  status: "open" | "close_requested" | "closed" | "voided";
  currencyCode: string;
  openingFloat: string;
  policyId: string;
  policyVersion: number;
  openedAt: string;
}>;

const shiftColumns = `id, branch_id, device_id, cashier_user_id, status,
  currency_code,
  to_char(opening_float, 'FM999999999999990.00') AS opening_float,
  policy_id, policy_version,
  to_char(opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS opened_at`;

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
  throw new Error("Cash shift command contains a non-JSON value.");
}
function fingerprint(value: unknown): Buffer {
  return createHash("sha256").update(canonicalJson(value)).digest();
}
function profile(row: ShiftRow): CashShiftProfile {
  return {
    id: row.id,
    branchId: row.branch_id,
    deviceId: row.device_id,
    cashierUserId: row.cashier_user_id,
    status: row.status,
    currencyCode: row.currency_code,
    openingFloat: row.opening_float,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    openedAt: row.opened_at,
  };
}
function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505" &&
    (error as { constraint?: string }).constraint === constraint
  );
}

@Injectable()
export class CashShiftService {
  constructor(@Inject(AUTHORIZATION_POOL) private readonly pool: Pool) {}

  async current(
    context: Context,
    branchId: string,
  ): Promise<CashShiftProfile | null> {
    return this.withTenant(context, async (client) => {
      const current = await client.query<ShiftRow>(
        `SELECT ${shiftColumns} FROM pos.cash_shift
         WHERE branch_id = $1
           AND status IN ('open', 'close_requested')
         ORDER BY opened_at DESC
         LIMIT 1`,
        [branchId],
      );
      return current.rowCount === 1 ? profile(current.rows[0]) : null;
    });
  }

  async open(
    context: Context,
    branchId: string,
    input: OpenCashShiftInput,
    idempotencyKey: string,
  ): Promise<CommandResponse<CashShiftProfile>> {
    try {
      return await this.command(
        context,
        "pos.cash_shift.open",
        idempotencyKey,
        fingerprint({ branchId, ...input }),
        async (client, correlationId) => {
          await this.assertRegisteredDevice(client, branchId, input.deviceId);
          const [policy, currencyCode] = await Promise.all([
            this.effectivePolicy(client, context, branchId),
            this.companyCurrency(client, context.companyId),
          ]);
          const created = await client.query<ShiftRow>(
            `INSERT INTO pos.cash_shift
               (company_id, branch_id, device_id, cashier_user_id, currency_code,
                opening_float, policy_id, policy_version)
             VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8)
             RETURNING ${shiftColumns}`,
            [
              context.companyId,
              branchId,
              input.deviceId,
              context.actorUserId,
              currencyCode,
              input.openingFloat,
              policy.id,
              policy.version,
            ],
          );
          const shift = profile(created.rows[0]);
          await this.audit(client, context.companyId, shift.id, {
            branchId,
            deviceId: input.deviceId,
            currencyCode: shift.currencyCode,
            openingFloat: shift.openingFloat,
            policyId: policy.id,
            policyVersion: policy.version,
          });
          return { correlationId, data: shift };
        },
      );
    } catch (error) {
      if (isUniqueViolation(error, "cash_shift_active_device_key"))
        throw new ConflictException(
          "This POS device already has an active cash shift.",
        );
      if (isUniqueViolation(error, "cash_shift_active_cashier_key"))
        throw new ConflictException("You already have an active cash shift.");
      throw error;
    }
  }

  private async assertRegisteredDevice(
    client: PoolClient,
    branchId: string,
    deviceId: string,
  ): Promise<void> {
    const device = await client.query<{ status: string }>(
      `SELECT status FROM platform.pos_device
       WHERE id = $1 AND branch_id = $2 FOR KEY SHARE`,
      [deviceId, branchId],
    );
    if (device.rowCount !== 1)
      throw new NotFoundException("POS device was not found.");
    if (device.rows[0].status !== "registered")
      throw new ConflictException(
        "Only a registered POS device can open a cash shift.",
      );
  }

  private async companyCurrency(
    client: PoolClient,
    companyId: string,
  ): Promise<string> {
    const company = await client.query<{ base_currency: string }>(
      "SELECT base_currency FROM platform.company WHERE id = $1 FOR KEY SHARE",
      [companyId],
    );
    if (company.rowCount !== 1)
      throw new NotFoundException("Company was not found.");
    return company.rows[0].base_currency;
  }

  private async effectivePolicy(
    client: PoolClient,
    context: Context,
    branchId: string,
  ): Promise<ShiftPolicy> {
    const policy = await client.query<ShiftPolicy>(
      `SELECT id, version FROM platform.policy_version
       WHERE company_id = $1
         AND (branch_id = $2 OR branch_id IS NULL)
         AND effective_from <= clock_timestamp()
       ORDER BY CASE WHEN branch_id = $2 THEN 0 ELSE 1 END,
                version DESC, effective_from DESC
       LIMIT 1`,
      [context.companyId, branchId],
    );
    if (policy.rowCount === 1) return policy.rows[0];

    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${context.companyId}:pos-policy:company`,
    ]);
    const afterLock = await client.query<ShiftPolicy>(
      `SELECT id, version FROM platform.policy_version
       WHERE company_id = $1 AND branch_id IS NULL
       ORDER BY version DESC, effective_from DESC LIMIT 1`,
      [context.companyId],
    );
    if (afterLock.rowCount === 1) return afterLock.rows[0];
    const created = await client.query<ShiftPolicy>(
      `INSERT INTO platform.policy_version (company_id, version)
       VALUES ($1, 1) RETURNING id, version`,
      [context.companyId],
    );
    return created.rows[0];
  }

  private async command<T>(
    context: Context,
    command: string,
    idempotencyKey: string,
    payloadFingerprint: Buffer,
    operation: (
      client: PoolClient,
      correlationId: string,
    ) => Promise<CommandResponse<T>>,
  ): Promise<CommandResponse<T>> {
    return this.withTenant(context, async (client) => {
      const acquired = await client.query<IdempotencyRow>(
        "SELECT * FROM platform.acquire_command_idempotency($1, $2, $3, $4)",
        [command, idempotencyKey, payloadFingerprint, randomUUID()],
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
        [command, idempotencyKey, response],
      );
      return response;
    });
  }

  private async audit(
    client: PoolClient,
    companyId: string,
    shiftId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await client.query("SELECT audit.write_event($1, $2, $3, $4, $5)", [
      companyId,
      "pos.cash_shift.opened",
      "pos.cash_shift",
      shiftId,
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
