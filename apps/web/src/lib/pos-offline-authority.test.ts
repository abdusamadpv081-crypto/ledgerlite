import { webcrypto } from "node:crypto";

import { describe, expect, it } from "vitest";
import {
  verifyOfflineAuthorityToken,
  type OfflineAuthorityScope,
  type OfflineAuthorityVerificationKey,
} from "./pos-offline-authority";
import { deriveCashierPinVerifier } from "./pos-cashier-pin";

const scope: OfflineAuthorityScope = {
  companyId: "c22ff1c3-253f-4457-bcc5-3098d827de20",
  branchId: "d556b3b8-fdbc-4ea6-9c0b-531dd8e704ed",
  deviceId: "f0fd3509-4724-4b95-86c8-d2a4a6f0a204",
  cashierUserId: "dcebc785-a5d1-474b-a5d1-2b27d04e6668",
};

function base64Url(value: Uint8Array | string): string {
  return Buffer.from(value).toString("base64url");
}

async function signedAuthority(): Promise<{
  token: string;
  verificationKey: OfflineAuthorityVerificationKey;
}> {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const verificationKey: OfflineAuthorityVerificationKey = {
    algorithm: "ES256",
    keyId: "test-offline-authority-key",
    publicKeyJwk: await webcrypto.subtle.exportKey("jwk", keyPair.publicKey),
  };
  const now = Date.now();
  const header = base64Url(
    JSON.stringify({
      alg: "ES256",
      kid: verificationKey.keyId,
      typ: "LL-Offline-Grant",
    }),
  );
  const payload = base64Url(
    JSON.stringify({
      ...scope,
      capabilities: ["pos.shift.operate", "pos.sale.create"],
      expiresAt: new Date(now + 60_000).toISOString(),
      grantId: "3e3e9195-2cb8-48c5-8a9d-6c629b15bb90",
      issuedAt: new Date(now - 1_000).toISOString(),
      issuer: "ledgerlite",
      policyId: "260a3b52-7ef4-4b5d-b96b-763e280c1a50",
      policyVersion: 3,
      schemaVersion: 1,
    }),
  );
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return {
    token: `${header}.${payload}.${base64Url(new Uint8Array(signature))}`,
    verificationKey,
  };
}

describe("offline authority verification", () => {
  it("accepts the expected signed, unexpired device grant", async () => {
    const signed = await signedAuthority();

    await expect(
      verifyOfflineAuthorityToken(
        webcrypto as unknown as Crypto,
        signed.token,
        signed.verificationKey,
        scope,
      ),
    ).resolves.toMatchObject({
      capabilities: ["pos.shift.operate", "pos.sale.create"],
      deviceId: scope.deviceId,
      policyVersion: 3,
    });
  });

  it("rejects a tampered token and a token for a different cashier", async () => {
    const signed = await signedAuthority();
    const tampered = `${signed.token.slice(0, -1)}${signed.token.endsWith("A") ? "B" : "A"}`;

    await expect(
      verifyOfflineAuthorityToken(
        webcrypto as unknown as Crypto,
        tampered,
        signed.verificationKey,
        scope,
      ),
    ).rejects.toThrow("signature");
    await expect(
      verifyOfflineAuthorityToken(
        webcrypto as unknown as Crypto,
        signed.token,
        signed.verificationKey,
        { ...scope, cashierUserId: "3e3e9195-2cb8-48c5-8a9d-6c629b15bb90" },
      ),
    ).rejects.toThrow("does not match");
  });
});

describe("cashier PIN verifier", () => {
  it("derives a stable PBKDF2 verifier without retaining PIN text", async () => {
    const salt = new Uint8Array(16).fill(7);
    const [first, repeated, changed] = await Promise.all([
      deriveCashierPinVerifier(
        webcrypto as unknown as Crypto,
        "82537491",
        salt,
      ),
      deriveCashierPinVerifier(
        webcrypto as unknown as Crypto,
        "82537491",
        salt,
      ),
      deriveCashierPinVerifier(
        webcrypto as unknown as Crypto,
        "91382746",
        salt,
      ),
    ]);

    expect(first).toEqual(repeated);
    expect(first).not.toEqual(changed);
    expect(first).toHaveLength(32);
  });
});
