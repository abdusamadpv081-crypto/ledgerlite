import { createHash } from "node:crypto";

import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { AUTHORIZATION_POOL } from "./authorization.service.js";
import {
  OIDC_PROVIDER,
  OIDC_TRANSACTION_CIPHER,
  type OidcProvider,
} from "./oidc-provider.js";
import { OidcTransactionCipher } from "./oidc-transaction-cipher.js";
import {
  SessionService,
  type IssuedBrowserSession,
} from "./session.service.js";

const OIDC_TRANSACTION_TTL_MINUTES = 10;
const RETURN_TO_MAXIMUM_LENGTH = 2048;

type ConsumedLoginTransaction = Readonly<{
  nonceCiphertext: Buffer;
  pkceCodeVerifierCiphertext: Buffer;
  returnTo: string;
}>;

export type StartedOidcLogin = Readonly<{
  authorizationUrl: URL;
}>;

export type CompletedOidcLogin = Readonly<{
  returnTo: string;
  session: IssuedBrowserSession;
}>;

function digestState(state: string): Buffer {
  return createHash("sha256").update(state).digest();
}

function normalizeReturnTo(returnTo: string | undefined): string {
  if (!returnTo) {
    return "/";
  }
  if (
    returnTo.length > RETURN_TO_MAXIMUM_LENGTH ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    returnTo.includes("\\")
  ) {
    throw new UnauthorizedException("The requested return path is not valid.");
  }
  return returnTo;
}

@Injectable()
export class OidcLoginService {
  constructor(
    @Inject(AUTHORIZATION_POOL) private readonly pool: Pool,
    private readonly sessions: SessionService,
    @Inject(OIDC_PROVIDER) private readonly provider: OidcProvider,
    @Inject(OIDC_TRANSACTION_CIPHER)
    private readonly transactionCipher: OidcTransactionCipher | undefined,
  ) {}

  async start(returnTo?: string): Promise<StartedOidcLogin> {
    const normalizedReturnTo = normalizeReturnTo(returnTo);
    const cipher = this.requiredCipher();
    const authorization = await this.provider.startAuthorization();
    await this.withApplicationRole((client) =>
      client.query(
        `INSERT INTO platform.oidc_login_transaction
           (state_digest, code_verifier_ciphertext, nonce_ciphertext, return_to, expires_at)
         VALUES ($1, $2, $3, $4, now() + ($5::integer * interval '1 minute'))`,
        [
          digestState(authorization.state),
          cipher.encrypt(authorization.pkceCodeVerifier),
          cipher.encrypt(authorization.nonce),
          normalizedReturnTo,
          OIDC_TRANSACTION_TTL_MINUTES,
        ],
      ),
    );
    return { authorizationUrl: authorization.authorizationUrl };
  }

  async complete(
    callbackUrl: URL,
    state: string | undefined,
  ): Promise<CompletedOidcLogin> {
    if (!state) {
      throw new UnauthorizedException("OIDC callback state is required.");
    }

    const cipher = this.requiredCipher();
    const transaction = await this.consume(state);
    const identity = await this.provider.exchangeAuthorizationCode(
      callbackUrl,
      {
        nonce: cipher.decrypt(transaction.nonceCiphertext),
        pkceCodeVerifier: cipher.decrypt(
          transaction.pkceCodeVerifierCiphertext,
        ),
        state,
      },
    );
    const actor = await this.resolveProvisionedActor(
      identity.providerId,
      identity.subject,
    );

    return {
      returnTo: transaction.returnTo,
      session: await this.sessions.issue(actor),
    };
  }

  private requiredCipher(): OidcTransactionCipher {
    if (!this.provider.isConfigured() || !this.transactionCipher) {
      throw new ServiceUnavailableException(
        "Online sign-in is not configured for this environment.",
      );
    }
    return this.transactionCipher;
  }

  private async consume(state: string): Promise<ConsumedLoginTransaction> {
    const transaction = await this.withApplicationRole(async (client) => {
      const result = await client.query<{
        code_verifier_ciphertext: Buffer;
        nonce_ciphertext: Buffer;
        return_to: string;
      }>(
        `UPDATE platform.oidc_login_transaction
         SET consumed_at = now()
         WHERE state_digest = $1
           AND consumed_at IS NULL
           AND expires_at > now()
         RETURNING code_verifier_ciphertext, nonce_ciphertext, return_to`,
        [digestState(state)],
      );
      return result.rows[0];
    });

    if (!transaction) {
      throw new UnauthorizedException(
        "The sign-in request has expired or was already used.",
      );
    }

    return {
      nonceCiphertext: transaction.nonce_ciphertext,
      pkceCodeVerifierCiphertext: transaction.code_verifier_ciphertext,
      returnTo: transaction.return_to,
    };
  }

  private async resolveProvisionedActor(
    identityProvider: string,
    externalSubject: string,
  ): Promise<{ userId: string }> {
    const user = await this.withApplicationRole(async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id
         FROM platform.app_user
         WHERE identity_provider = $1
           AND external_subject = $2
           AND status = 'active'
         FOR KEY SHARE`,
        [identityProvider, externalSubject],
      );
      return result.rows[0];
    });

    if (!user) {
      throw new UnauthorizedException(
        "This identity has not been provisioned for Ledger Lite.",
      );
    }

    return { userId: user.id };
  }

  private async withApplicationRole<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE ledgerlite_app");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
