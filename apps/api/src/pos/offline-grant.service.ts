import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  webcrypto,
} from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { offlineGrantChallengePayload } from "@ledgerlite/domain";
import { Pool, type PoolClient } from "pg";
import { AUTHORIZATION_POOL } from "../auth/authorization.service.js";
import {
  OfflineGrantSigner,
  type OfflineGrantPayload,
  type OfflineGrantVerificationKey,
} from "./offline-grant-signer.js";

type Context = Readonly<{ actorUserId: string; companyId: string }>;
type DeviceRow = Readonly<{
  id: string;
  public_key_jwk: JsonWebKey;
  status: "registered" | "suspended" | "retired";
}>;
type ChallengeRow = Readonly<{
  branch_id: string;
  cashier_user_id: string;
  device_id: string;
  expires_at: string;
  nonce_digest: Buffer;
  consumed_at: string | null;
}>;
type PolicyRow = Readonly<{
  id: string;
  offline_max_hours: number;
  version: number;
}>;
type IdempotencyRow = Readonly<{
  correlation_id: string;
  is_new: boolean;
  response: CommandResponse<unknown> | null;
}>;
export type CommandResponse<T> = Readonly<{
  correlationId: string;
  data: T;
}>;
export type OfflineGrantChallenge = Readonly<{
  challengeId: string;
  deviceId: string;
  expiresAt: string;
  nonce: string;
}>;
export type IssueOfflineGrantInput = Readonly<{
  challengeId: string;
  nonce: string;
  signature: string;
}>;
export type OfflineGrant = Readonly<{
  capabilities: readonly ("pos.shift.operate" | "pos.sale.create")[];
  deviceId: string;
  expiresAt: string;
  grantId: string;
  issuedAt: string;
  policyId: string;
  policyVersion: number;
  token: string;
}>;

const offlineCapabilities = ["pos.shift.operate", "pos.sale.create"] as const;
const challengeLifetimeMs = 5 * 60 * 1000;

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
  throw new Error("Offline grant command contains a non-JSON value.");
}
function sha256(value: string | unknown): Buffer {
  const body = typeof value === "string" ? value : canonicalJson(value);
  return createHash("sha256").update(body).digest();
}
function timestamp(value: Date): string {
  return value.toISOString();
}
function base64UrlBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}
function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

@Injectable()
export class OfflineGrantService {
  constructor(
    @Inject(AUTHORIZATION_POOL) private readonly pool: Pool,
    private readonly signer: OfflineGrantSigner,
  ) {}

  verificationKey(): OfflineGrantVerificationKey {
    return this.signer.verificationKey();
  }

  async createChallenge(
    context: Context,
    branchId: string,
    deviceId: string,
    idempotencyKey: string,
  ): Promise<CommandResponse<OfflineGrantChallenge>> {
    return this.command(
      context,
      "pos.offline_grant.challenge.create",
      idempotencyKey,
      { branchId, deviceId },
      async (client, correlationId) => {
        await this.assertRegisteredDevice(client, branchId, deviceId);
        const nonce = randomBytes(32).toString("base64url");
        const expiresAt = timestamp(new Date(Date.now() + challengeLifetimeMs));
        const created = await client.query<{ id: string }>(
          `INSERT INTO pos.offline_grant_challenge
             (company_id, branch_id, device_id, cashier_user_id, nonce_digest, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
           RETURNING id`,
          [
            context.companyId,
            branchId,
            deviceId,
            context.actorUserId,
            sha256(nonce),
            expiresAt,
          ],
        );
        return {
          correlationId,
          data: {
            challengeId: created.rows[0].id,
            deviceId,
            expiresAt,
            nonce,
          },
        };
      },
    );
  }

  async issue(
    context: Context,
    branchId: string,
    input: IssueOfflineGrantInput,
    idempotencyKey: string,
  ): Promise<CommandResponse<OfflineGrant>> {
    return this.command(
      context,
      "pos.offline_grant.issue",
      idempotencyKey,
      input,
      async (client, correlationId) => {
        const challenge = await client.query<ChallengeRow>(
          `SELECT branch_id, cashier_user_id, device_id,
                  to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at,
                  nonce_digest, consumed_at
           FROM pos.offline_grant_challenge
           WHERE id = $1 FOR UPDATE`,
          [input.challengeId],
        );
        if (challenge.rowCount !== 1)
          throw new NotFoundException("Offline grant challenge was not found.");
        const record = challenge.rows[0];
        if (
          record.branch_id !== branchId ||
          record.cashier_user_id !== context.actorUserId
        )
          throw new ForbiddenException(
            "Offline grant challenge is not valid for this cashier and branch.",
          );
        if (record.consumed_at !== null)
          throw new ConflictException(
            "Offline grant challenge was already used.",
          );
        if (Date.parse(record.expires_at) <= Date.now())
          throw new ConflictException("Offline grant challenge has expired.");
        const nonceDigest = sha256(input.nonce);
        if (
          nonceDigest.length !== record.nonce_digest.length ||
          !timingSafeEqual(nonceDigest, record.nonce_digest)
        )
          throw new ForbiddenException("Offline grant challenge is invalid.");

        const device = await this.assertRegisteredDevice(
          client,
          branchId,
          record.device_id,
        );
        const signatureIsValid = await this.verifyDeviceSignature(
          device.public_key_jwk,
          input.challengeId,
          input.nonce,
          input.signature,
        );
        if (!signatureIsValid)
          throw new ForbiddenException("Device proof could not be verified.");

        const policy = await this.effectivePolicy(client, context, branchId);
        const issuedAt = new Date();
        const expiresAt = new Date(
          issuedAt.getTime() + policy.offline_max_hours * 60 * 60 * 1000,
        );
        const grantId = randomUUID();
        const payload: OfflineGrantPayload = {
          branchId,
          capabilities: offlineCapabilities,
          cashierUserId: context.actorUserId,
          companyId: context.companyId,
          deviceId: device.id,
          expiresAt: timestamp(expiresAt),
          grantId,
          issuedAt: timestamp(issuedAt),
          issuer: "ledgerlite",
          policyId: policy.id,
          policyVersion: policy.version,
          schemaVersion: 1,
        };
        const token = await this.signer.sign(payload);
        await client.query(
          `INSERT INTO pos.offline_operational_grant
             (id, company_id, branch_id, device_id, cashier_user_id, policy_id,
              policy_version, capabilities, token_digest, issued_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)`,
          [
            grantId,
            context.companyId,
            branchId,
            device.id,
            context.actorUserId,
            policy.id,
            policy.version,
            offlineCapabilities,
            sha256(token),
            payload.issuedAt,
            payload.expiresAt,
          ],
        );
        await client.query(
          "UPDATE pos.offline_grant_challenge SET consumed_at = clock_timestamp() WHERE id = $1",
          [input.challengeId],
        );
        await this.audit(client, context.companyId, grantId, {
          branchId,
          deviceId: device.id,
          expiresAt: payload.expiresAt,
          policyId: policy.id,
          policyVersion: policy.version,
        });
        return {
          correlationId,
          data: {
            capabilities: offlineCapabilities,
            deviceId: device.id,
            expiresAt: payload.expiresAt,
            grantId,
            issuedAt: payload.issuedAt,
            policyId: policy.id,
            policyVersion: policy.version,
            token,
          },
        };
      },
    );
  }

  private async assertRegisteredDevice(
    client: PoolClient,
    branchId: string,
    deviceId: string,
  ): Promise<DeviceRow> {
    const device = await client.query<DeviceRow>(
      `SELECT id, public_key_jwk, status FROM platform.pos_device
       WHERE id = $1 AND branch_id = $2 FOR KEY SHARE`,
      [deviceId, branchId],
    );
    if (device.rowCount !== 1)
      throw new NotFoundException("POS device was not found.");
    if (device.rows[0].status !== "registered")
      throw new ConflictException(
        "Only a registered POS device can receive offline authority.",
      );
    return device.rows[0];
  }

  private async effectivePolicy(
    client: PoolClient,
    context: Context,
    branchId: string,
  ): Promise<PolicyRow> {
    const policy = await client.query<PolicyRow>(
      `SELECT id, offline_max_hours, version FROM platform.policy_version
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
    const afterLock = await client.query<PolicyRow>(
      `SELECT id, offline_max_hours, version FROM platform.policy_version
       WHERE company_id = $1 AND branch_id IS NULL
       ORDER BY version DESC, effective_from DESC LIMIT 1`,
      [context.companyId],
    );
    if (afterLock.rowCount === 1) return afterLock.rows[0];
    const created = await client.query<PolicyRow>(
      `INSERT INTO platform.policy_version (company_id, version)
       VALUES ($1, 1) RETURNING id, offline_max_hours, version`,
      [context.companyId],
    );
    return created.rows[0];
  }

  private async verifyDeviceSignature(
    publicKeyJwk: JsonWebKey,
    challengeId: string,
    nonce: string,
    signature: string,
  ): Promise<boolean> {
    try {
      const publicKey = await webcrypto.subtle.importKey(
        "jwk",
        publicKeyJwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      return webcrypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        arrayBuffer(base64UrlBytes(signature)),
        arrayBuffer(offlineGrantChallengePayload(challengeId, nonce)),
      );
    } catch {
      return false;
    }
  }

  private async command<T>(
    context: Context,
    command: string,
    idempotencyKey: string,
    payload: unknown,
    operation: (
      client: PoolClient,
      correlationId: string,
    ) => Promise<CommandResponse<T>>,
  ): Promise<CommandResponse<T>> {
    return this.withTenant(context, async (client) => {
      const acquired = await client.query<IdempotencyRow>(
        "SELECT * FROM platform.acquire_command_idempotency($1, $2, $3, $4)",
        [command, idempotencyKey, sha256(payload), randomUUID()],
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
    grantId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await client.query("SELECT audit.write_event($1, $2, $3, $4, $5)", [
      companyId,
      "pos.offline_grant.issued",
      "pos.offline_operational_grant",
      grantId,
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
