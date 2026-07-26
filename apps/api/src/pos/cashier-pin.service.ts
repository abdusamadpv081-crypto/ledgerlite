import { argon2, createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { AUTHORIZATION_POOL } from "../auth/authorization.service.js";

type Context = Readonly<{ companyId: string; actorUserId: string }>;
type PinPolicy = Readonly<{
  id: string;
  version: number;
  pos_pin_min_length: number;
  pos_pin_max_length: number;
  offline_pin_max_failures: number;
  offline_pin_cool_off_minutes: number;
  offline_cashier_session_max_hours: number;
}>;
type IdempotencyRow = Readonly<{
  correlation_id: string;
  is_new: boolean;
  response: CommandResponse<unknown> | null;
}>;
type PinSettings = Readonly<{ pepper: Buffer }>;
export type CommandResponse<T> = Readonly<{
  correlationId: string;
  data: T;
}>;
export type SetCashierPinInput = Readonly<{
  deviceId: string;
  pin: string;
}>;
export type CashierPinProfile = Readonly<{
  pinVersion: number;
  changedAt: string;
  policy: Readonly<{
    id: string;
    version: number;
    minLength: number;
    maxLength: number;
    maxFailedAttempts: number;
    coolOffMinutes: number;
    maxSessionHours: number;
  }>;
}>;

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
  throw new Error("Cashier PIN command contains a non-JSON value.");
}
function pinPolicy(policy: PinPolicy): CashierPinProfile["policy"] {
  return {
    id: policy.id,
    version: policy.version,
    minLength: policy.pos_pin_min_length,
    maxLength: policy.pos_pin_max_length,
    maxFailedAttempts: policy.offline_pin_max_failures,
    coolOffMinutes: policy.offline_pin_cool_off_minutes,
    maxSessionHours: policy.offline_cashier_session_max_hours,
  };
}
@Injectable()
export class CashierPinService {
  constructor(@Inject(AUTHORIZATION_POOL) private readonly pool: Pool) {}

  async set(
    context: Context,
    branchId: string,
    input: SetCashierPinInput,
    idempotencyKey: string,
  ): Promise<CommandResponse<CashierPinProfile>> {
    const settings = this.settings();
    return this.command(
      context,
      "pos.cashier_pin.set",
      idempotencyKey,
      this.fingerprint(settings, { branchId, ...input }),
      async (client, correlationId) => {
        await this.assertRegisteredDevice(client, branchId, input.deviceId);
        const policy = await this.effectivePolicy(client, context, branchId);
        if (
          input.pin.length < policy.pos_pin_min_length ||
          input.pin.length > policy.pos_pin_max_length
        )
          throw new ConflictException(
            `POS PIN must contain ${policy.pos_pin_min_length}–${policy.pos_pin_max_length} digits.`,
          );
        const salt = randomBytes(16);
        const hash = await this.hashPin(input.pin, salt, settings);
        const updated = await client.query<{
          version: number;
          changed_at: string;
        }>(
          `INSERT INTO pos.cashier_pin
             (company_id, cashier_user_id, salt, hash)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (company_id, cashier_user_id) DO UPDATE
             SET salt = EXCLUDED.salt,
                 hash = EXCLUDED.hash,
                 version = pos.cashier_pin.version + 1,
                 changed_at = clock_timestamp()
           RETURNING version,
             to_char(changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS changed_at`,
          [context.companyId, context.actorUserId, salt, hash],
        );
        const profile: CashierPinProfile = {
          pinVersion: updated.rows[0].version,
          changedAt: updated.rows[0].changed_at,
          policy: pinPolicy(policy),
        };
        await this.audit(client, context.companyId, context.actorUserId, {
          branchId,
          deviceId: input.deviceId,
          pinVersion: profile.pinVersion,
          policyId: policy.id,
          policyVersion: policy.version,
        });
        return { correlationId, data: profile };
      },
    );
  }

  private settings(): PinSettings {
    const rawPepper = process.env.POS_PIN_PEPPER;
    if (!rawPepper || !/^[A-Za-z0-9_-]{43,}$/.test(rawPepper))
      throw new ServiceUnavailableException(
        "Cashier PIN security is not configured for this environment.",
      );
    const pepper = Buffer.from(rawPepper, "base64url");
    if (pepper.length < 32)
      throw new ServiceUnavailableException(
        "Cashier PIN security is not configured for this environment.",
      );
    return { pepper };
  }

  private fingerprint(settings: PinSettings, value: unknown): Buffer {
    return createHmac("sha256", settings.pepper)
      .update(canonicalJson(value))
      .digest();
  }

  private async hashPin(
    pin: string,
    salt: Buffer,
    settings: PinSettings,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      argon2(
        "argon2id",
        {
          message: pin,
          nonce: salt,
          parallelism: 1,
          tagLength: 32,
          memory: 65_536,
          passes: 3,
          secret: settings.pepper,
        },
        (error, derivedKey) => {
          if (error) reject(error);
          else resolve(derivedKey);
        },
      );
    });
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
        "Only a registered POS device can set a local cashier PIN.",
      );
  }

  private async effectivePolicy(
    client: PoolClient,
    context: Context,
    branchId: string,
  ): Promise<PinPolicy> {
    const policy = await client.query<PinPolicy>(
      `SELECT id, version, pos_pin_min_length, pos_pin_max_length,
              offline_pin_max_failures, offline_pin_cool_off_minutes,
              offline_cashier_session_max_hours
       FROM platform.policy_version
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
    const afterLock = await client.query<PinPolicy>(
      `SELECT id, version, pos_pin_min_length, pos_pin_max_length,
              offline_pin_max_failures, offline_pin_cool_off_minutes,
              offline_cashier_session_max_hours
       FROM platform.policy_version
       WHERE company_id = $1 AND branch_id IS NULL
       ORDER BY version DESC, effective_from DESC LIMIT 1`,
      [context.companyId],
    );
    if (afterLock.rowCount === 1) return afterLock.rows[0];
    const created = await client.query<PinPolicy>(
      `INSERT INTO platform.policy_version (company_id, version)
       VALUES ($1, 1)
       RETURNING id, version, pos_pin_min_length, pos_pin_max_length,
         offline_pin_max_failures, offline_pin_cool_off_minutes,
         offline_cashier_session_max_hours`,
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
    cashierUserId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await client.query("SELECT audit.write_event($1, $2, $3, $4, $5)", [
      companyId,
      "pos.cashier_pin.set",
      "pos.cashier_pin",
      cashierUserId,
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
