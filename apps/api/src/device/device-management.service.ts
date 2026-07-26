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
type JsonObject = Readonly<Record<string, unknown>>;
export type DeviceProfile = Readonly<{
  id: string;
  companyId: string;
  branchId: string;
  displayName: string;
  publicKeyFingerprint: string;
  status: "registered" | "suspended" | "retired";
  appVersion: string | null;
  localSchemaVersion: number | null;
  policyVersion: number | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;
export type RegisterDeviceInput = Readonly<{
  displayName: string;
  publicKeyJwk: JsonObject;
  appVersion?: string;
  localSchemaVersion?: number;
}>;
export type UpdateDeviceStatusInput = Readonly<{
  expectedUpdatedAt: string;
  status: DeviceProfile["status"];
}>;
type CommandResponse<T> = Readonly<{ data: T; correlationId: string }>;
type IdempotencyRow = Readonly<{
  is_new: boolean;
  response: CommandResponse<unknown> | null;
  correlation_id: string;
}>;
type DeviceRow = Readonly<{
  id: string;
  company_id: string;
  branch_id: string;
  display_name: string;
  public_key_fingerprint: string;
  status: DeviceProfile["status"];
  app_version: string | null;
  local_schema_version: number | null;
  policy_version: number | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}>;

const deviceColumns = `id, company_id, branch_id, display_name,
  public_key_fingerprint, status, app_version, local_schema_version, policy_version,
  to_char(last_synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_synced_at,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
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
  throw new Error("Device key contains a non-JSON value.");
}
function sha256(value: unknown): Buffer {
  return createHash("sha256").update(canonicalJson(value)).digest();
}
function fingerprint(publicKeyJwk: JsonObject): string {
  return sha256(publicKeyJwk).toString("hex");
}
function deviceProfile(row: DeviceRow): DeviceProfile {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    displayName: row.display_name,
    publicKeyFingerprint: row.public_key_fingerprint,
    status: row.status,
    appVersion: row.app_version,
    localSchemaVersion: row.local_schema_version,
    policyVersion: row.policy_version,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class DeviceManagementService {
  constructor(@Inject(AUTHORIZATION_POOL) private readonly pool: Pool) {}

  async list(
    context: Context,
    branchId: string,
  ): Promise<readonly DeviceProfile[]> {
    return this.withTenant(context, async (client) => {
      const devices = await client.query<DeviceRow>(
        `SELECT ${deviceColumns} FROM platform.pos_device
         WHERE branch_id = $1 ORDER BY display_name`,
        [branchId],
      );
      return devices.rows.map(deviceProfile);
    });
  }

  async register(
    context: Context,
    branchId: string,
    input: RegisterDeviceInput,
    key: string,
  ): Promise<CommandResponse<DeviceProfile>> {
    return this.command(
      context,
      "pos.device.register",
      key,
      input,
      async (client, correlationId) => {
        const branch = await client.query<{ status: string }>(
          "SELECT status FROM platform.branch WHERE id = $1",
          [branchId],
        );
        if (branch.rowCount !== 1)
          throw new NotFoundException("Branch was not found.");
        if (branch.rows[0].status !== "active")
          throw new ConflictException(
            "A device can only be registered to an active branch.",
          );

        const created = await client.query<DeviceRow>(
          `INSERT INTO platform.pos_device
             (company_id, branch_id, display_name, public_key_jwk,
              public_key_fingerprint, app_version, local_schema_version)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
           RETURNING ${deviceColumns}`,
          [
            context.companyId,
            branchId,
            input.displayName,
            input.publicKeyJwk,
            fingerprint(input.publicKeyJwk),
            input.appVersion ?? null,
            input.localSchemaVersion ?? null,
          ],
        );
        const device = deviceProfile(created.rows[0]);
        await this.audit(
          client,
          context.companyId,
          "pos.device.registered",
          device.id,
          {
            branchId,
            publicKeyFingerprint: device.publicKeyFingerprint,
          },
        );
        return { data: device, correlationId };
      },
    );
  }

  async updateStatus(
    context: Context,
    branchId: string,
    deviceId: string,
    input: UpdateDeviceStatusInput,
    key: string,
  ): Promise<CommandResponse<DeviceProfile>> {
    return this.command(
      context,
      "pos.device.status.update",
      key,
      input,
      async (client, correlationId) => {
        const updated = await client.query<DeviceRow>(
          `UPDATE platform.pos_device SET status = $1
           WHERE id = $2 AND branch_id = $3
             AND updated_at = $4::timestamptz
           RETURNING ${deviceColumns}`,
          [input.status, deviceId, branchId, input.expectedUpdatedAt],
        );
        if (updated.rowCount !== 1) {
          const exists = await client.query(
            "SELECT id FROM platform.pos_device WHERE id = $1 AND branch_id = $2",
            [deviceId, branchId],
          );
          if (exists.rowCount !== 1)
            throw new NotFoundException("Device was not found.");
          throw new ConflictException(
            "Device was changed by another user. Refresh and try again.",
          );
        }
        const device = deviceProfile(updated.rows[0]);
        await this.audit(
          client,
          context.companyId,
          "pos.device.status_changed",
          device.id,
          {
            branchId,
            status: device.status,
          },
        );
        return { data: device, correlationId };
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
        [command, key, sha256(payload), randomUUID()],
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
    deviceId: string,
    metadata: JsonObject,
  ): Promise<void> {
    await client.query("SELECT audit.write_event($1, $2, $3, $4, $5)", [
      companyId,
      action,
      "platform.pos_device",
      deviceId,
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
        throw new ConflictException(
          "The device signing key is already registered.",
        );
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
