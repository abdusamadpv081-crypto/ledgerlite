import { randomUUID, webcrypto } from "node:crypto";

import { ConflictException } from "@nestjs/common";
import { offlineGrantChallengePayload } from "@ledgerlite/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { OfflineGrantService } from "../src/pos/offline-grant.service.js";
import { OfflineGrantSigner } from "../src/pos/offline-grant-signer.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const suffix = randomUUID();
const originalSigningKey = process.env.POS_OFFLINE_GRANT_SIGNING_PRIVATE_JWK;
const originalSigningKeyId = process.env.POS_OFFLINE_GRANT_SIGNING_KEY_ID;
let companyId: string;
let branchId: string;
let actorUserId: string;
let deviceId: string;
let deviceSigningKey: CryptoKey;
let grants: OfflineGrantService;

function toBase64Url(value: ArrayBuffer): string {
  return Buffer.from(value).toString("base64url");
}
function fromBase64Url(value: string): ArrayBuffer {
  const bytes = new Uint8Array(Buffer.from(value, "base64url"));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeAll(async () => {
  const grantSigningPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = await webcrypto.subtle.exportKey(
    "jwk",
    grantSigningPair.privateKey,
  );
  process.env.POS_OFFLINE_GRANT_SIGNING_PRIVATE_JWK =
    JSON.stringify(privateJwk);
  process.env.POS_OFFLINE_GRANT_SIGNING_KEY_ID = `test-offline-grant-${suffix}`;

  const deviceKeyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  deviceSigningKey = deviceKeyPair.privateKey;
  const devicePublicKey = await webcrypto.subtle.exportKey(
    "jwk",
    deviceKeyPair.publicKey,
  );
  const signer = new OfflineGrantSigner();
  grants = new OfflineGrantService(pool, signer);

  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Offline grant service ${suffix}`],
    )
  ).rows[0].id;
  branchId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.branch (company_id, code, name)
       VALUES ($1, 'MAIN', 'Main branch') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
  actorUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
       (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Offline grant test cashier') RETURNING id`,
      [`offline-grant-${suffix}`],
    )
  ).rows[0].id;
  deviceId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.pos_device
         (company_id, branch_id, display_name, public_key_jwk,
          public_key_fingerprint)
       VALUES ($1, $2, 'Till one', $3::jsonb, $4) RETURNING id`,
      [companyId, branchId, devicePublicKey, `test-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO platform.policy_version
       (company_id, version, offline_max_hours)
     VALUES ($1, 1, 4)`,
    [companyId],
  );
});

afterAll(async () => {
  restore("POS_OFFLINE_GRANT_SIGNING_PRIVATE_JWK", originalSigningKey);
  restore("POS_OFFLINE_GRANT_SIGNING_KEY_ID", originalSigningKeyId);
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
      "DELETE FROM pos.offline_operational_grant WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM pos.offline_grant_challenge WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM platform.policy_version WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM platform.pos_device WHERE company_id = $1",
      [companyId],
    );
    await client.query("DELETE FROM platform.branch WHERE company_id = $1", [
      companyId,
    ]);
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

describe("OfflineGrantService", () => {
  it("issues one auditable, device-bound grant and preserves idempotent retries", async () => {
    const context = { companyId, actorUserId };
    const challenge = await grants.createChallenge(
      context,
      branchId,
      deviceId,
      `offline-grant-challenge-${suffix}`,
    );
    const signature = toBase64Url(
      await webcrypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        deviceSigningKey,
        offlineGrantChallengePayload(
          challenge.data.challengeId,
          challenge.data.nonce,
        ),
      ),
    );
    const input = {
      challengeId: challenge.data.challengeId,
      nonce: challenge.data.nonce,
      signature,
    };
    const issued = await grants.issue(
      context,
      branchId,
      input,
      `offline-grant-issue-${suffix}`,
    );
    const retried = await grants.issue(
      context,
      branchId,
      input,
      `offline-grant-issue-${suffix}`,
    );

    expect(retried).toEqual(issued);
    expect(issued.data).toMatchObject({
      capabilities: ["pos.shift.operate", "pos.sale.create"],
      deviceId,
      policyVersion: 1,
    });

    const [header, payload, signaturePart] = issued.data.token.split(".");
    const key = grants.verificationKey();
    const publicKey = await webcrypto.subtle.importKey(
      "jwk",
      key.publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    await expect(
      webcrypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        fromBase64Url(signaturePart),
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).resolves.toBe(true);
    expect(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    ).toMatchObject({
      branchId,
      capabilities: ["pos.shift.operate", "pos.sale.create"],
      cashierUserId: actorUserId,
      companyId,
      deviceId,
      grantId: issued.data.grantId,
      issuer: "ledgerlite",
      schemaVersion: 1,
    });

    const [grantsInDatabase, audit] = await Promise.all([
      pool.query<{ token_digest: Buffer }>(
        `SELECT token_digest FROM pos.offline_operational_grant
         WHERE company_id = $1 AND id = $2`,
        [companyId, issued.data.grantId],
      ),
      pool.query<{ action: string; correlation_id: string | null }>(
        `SELECT action, correlation_id::text FROM audit.event
         WHERE company_id = $1 ORDER BY occurred_at`,
        [companyId],
      ),
    ]);
    expect(grantsInDatabase.rows).toHaveLength(1);
    expect(
      grantsInDatabase.rows[0].token_digest.equals(
        Buffer.from(issued.data.token),
      ),
    ).toBe(false);
    expect(audit.rows).toEqual([
      expect.objectContaining({ action: "pos.offline_grant.issued" }),
    ]);
    expect(audit.rows[0].correlation_id).not.toBeNull();

    await expect(
      grants.issue(
        context,
        branchId,
        input,
        `offline-grant-second-use-${suffix}`,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
