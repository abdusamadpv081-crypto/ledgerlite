import { createHash, randomBytes, randomUUID } from "node:crypto";

import { UnauthorizedException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  type OidcAuthorizationRequest,
  type OidcIdentity,
  type OidcProvider,
} from "../src/auth/oidc-provider.js";
import { OidcLoginService } from "../src/auth/oidc-login.service.js";
import { OidcTransactionCipher } from "../src/auth/oidc-transaction-cipher.js";
import { SessionService } from "../src/auth/session.service.js";

const providerId = "https://identity.ledgerlite.test/";

class FakeOidcProvider implements OidcProvider {
  private requestNumber = 0;
  identity: OidcIdentity = {
    providerId,
    subject: "provisioned-subject",
  };

  isConfigured(): boolean {
    return true;
  }

  callbackUrl(requestUrl: string): URL {
    return new URL(requestUrl, "https://app.ledgerlite.test");
  }

  async startAuthorization(): Promise<OidcAuthorizationRequest> {
    this.requestNumber += 1;
    const suffix = String(this.requestNumber);
    return {
      authorizationUrl: new URL(
        `https://identity.ledgerlite.test/authorize?state=state-${suffix}`,
      ),
      nonce: `nonce-${suffix}`,
      pkceCodeVerifier: `verifier-${suffix}`,
      state: `state-${suffix}`,
    };
  }

  async exchangeAuthorizationCode(
    callbackUrl: URL,
    checks: Readonly<{
      nonce: string;
      pkceCodeVerifier: string;
      state: string;
    }>,
  ): Promise<OidcIdentity> {
    const suffix = checks.state.replace("state-", "");
    if (
      callbackUrl.searchParams.get("code") !== "authorization-code" ||
      callbackUrl.searchParams.get("state") !== checks.state ||
      checks.nonce !== `nonce-${suffix}` ||
      checks.pkceCodeVerifier !== `verifier-${suffix}`
    ) {
      throw new Error("OIDC checks did not match the login transaction.");
    }
    return this.identity;
  }
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const provider = new FakeOidcProvider();
const sessions = new SessionService(pool);
const returnTo = `/pos/${randomUUID()}`;
const login = new OidcLoginService(
  pool,
  sessions,
  provider,
  new OidcTransactionCipher(randomBytes(32)),
);

let userId: string;

beforeAll(async () => {
  userId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
         (identity_provider, external_subject, display_name)
       VALUES ($1, 'provisioned-subject', 'Provisioned OIDC user')
       RETURNING id`,
      [providerId],
    )
  ).rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM platform.browser_session WHERE user_id = $1", [
    userId,
  ]);
  await pool.query("DELETE FROM platform.app_user WHERE id = $1", [userId]);
  await pool.query(
    "DELETE FROM platform.oidc_login_transaction WHERE return_to = $1",
    [returnTo],
  );
  await pool.end();
});

describe("OidcLoginService", () => {
  it("stores encrypted PKCE state, completes once, and issues a server session", async () => {
    const started = await login.start(returnTo);
    expect(started.authorizationUrl.searchParams.get("state")).toBe("state-1");

    const stateDigest = createHash("sha256").update("state-1").digest();
    const transaction = await pool.query<{
      code_verifier_ciphertext: Buffer;
      nonce_ciphertext: Buffer;
    }>(
      `SELECT code_verifier_ciphertext, nonce_ciphertext
       FROM platform.oidc_login_transaction
       WHERE state_digest = $1`,
      [stateDigest],
    );
    expect(
      transaction.rows[0].code_verifier_ciphertext.toString(),
    ).not.toContain("verifier-1");
    expect(transaction.rows[0].nonce_ciphertext.toString()).not.toContain(
      "nonce-1",
    );

    const completed = await login.complete(
      "/api/v1/auth/callback?code=authorization-code&state=state-1",
      "state-1",
    );
    expect(completed.returnTo).toBe(returnTo);
    await expect(
      sessions.authenticate(completed.session.token),
    ).resolves.toEqual({
      userId,
    });

    await expect(
      login.complete(
        "/api/v1/auth/callback?code=authorization-code&state=state-1",
        "state-1",
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects an unsafe return path and an identity that was not provisioned", async () => {
    await expect(login.start("//external.example")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    provider.identity = { providerId, subject: "unknown-subject" };
    await login.start(returnTo);
    await expect(
      login.complete(
        "/api/v1/auth/callback?code=authorization-code&state=state-2",
        "state-2",
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
