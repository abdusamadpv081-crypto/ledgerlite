import { webcrypto } from "node:crypto";

import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export type OfflineGrantPayload = Readonly<{
  branchId: string;
  capabilities: readonly string[];
  cashierUserId: string;
  companyId: string;
  deviceId: string;
  expiresAt: string;
  grantId: string;
  issuedAt: string;
  issuer: "ledgerlite";
  policyId: string;
  policyVersion: number;
  schemaVersion: 1;
}>;
export type OfflineGrantVerificationKey = Readonly<{
  algorithm: "ES256";
  keyId: string;
  publicKeyJwk: JsonWebKey;
}>;
type SigningSettings = Readonly<{
  keyId: string;
  privateKeyJwk: JsonWebKey;
  publicKeyJwk: JsonWebKey;
}>;

function base64Url(value: Uint8Array | string): string {
  return Buffer.from(value).toString("base64url");
}
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
  throw new Error("Offline grant payload contains a non-JSON value.");
}
function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

@Injectable()
export class OfflineGrantSigner {
  async sign(payload: OfflineGrantPayload): Promise<string> {
    const settings = this.settings();
    const header = base64Url(
      canonicalJson({
        alg: "ES256",
        kid: settings.keyId,
        typ: "LL-Offline-Grant",
      }),
    );
    const body = base64Url(canonicalJson(payload));
    const signingInput = new TextEncoder().encode(`${header}.${body}`);
    const privateKey = await webcrypto.subtle.importKey(
      "jwk",
      settings.privateKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const signature = await webcrypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      arrayBuffer(signingInput),
    );
    return `${header}.${body}.${base64Url(new Uint8Array(signature))}`;
  }

  verificationKey(): OfflineGrantVerificationKey {
    const settings = this.settings();
    return {
      algorithm: "ES256",
      keyId: settings.keyId,
      publicKeyJwk: settings.publicKeyJwk,
    };
  }

  private settings(): SigningSettings {
    const rawPrivateKey = process.env.POS_OFFLINE_GRANT_SIGNING_PRIVATE_JWK;
    const keyId = process.env.POS_OFFLINE_GRANT_SIGNING_KEY_ID;
    if (!rawPrivateKey || !keyId)
      throw new ServiceUnavailableException(
        "Offline grant signing is not configured for this environment.",
      );
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(keyId))
      throw new ServiceUnavailableException(
        "Offline grant signing key ID is invalid.",
      );

    let privateKey: unknown;
    try {
      privateKey = JSON.parse(rawPrivateKey);
    } catch {
      throw new ServiceUnavailableException(
        "Offline grant signing key is invalid.",
      );
    }
    if (
      typeof privateKey !== "object" ||
      privateKey === null ||
      Array.isArray(privateKey)
    )
      throw new ServiceUnavailableException(
        "Offline grant signing key is invalid.",
      );
    const key = privateKey as Record<string, unknown>;
    if (
      key.kty !== "EC" ||
      key.crv !== "P-256" ||
      typeof key.x !== "string" ||
      typeof key.y !== "string" ||
      typeof key.d !== "string"
    )
      throw new ServiceUnavailableException(
        "Offline grant signing key must be an EC P-256 private JWK.",
      );

    return {
      keyId,
      privateKeyJwk: {
        alg: "ES256",
        crv: "P-256",
        d: key.d,
        ext: false,
        key_ops: ["sign"],
        kty: "EC",
        x: key.x,
        y: key.y,
      },
      publicKeyJwk: {
        alg: "ES256",
        crv: "P-256",
        ext: true,
        key_ops: ["verify"],
        kty: "EC",
        x: key.x,
        y: key.y,
      },
    };
  }
}
