import { createHash, randomBytes } from "node:crypto";

import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { AUTHORIZATION_POOL } from "./authorization.service.js";

const SESSION_TOKEN_BYTES = 32;
const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AuthenticatedActor = Readonly<{
  userId: string;
}>;

export type IssuedBrowserSession = Readonly<{
  actor: AuthenticatedActor;
  expiresAt: Date;
  token: string;
}>;

export type SessionInvalidationReason =
  "admin_revocation" | "logout" | "rotated" | "security_event";

function digestToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function isSessionToken(value: string): boolean {
  return SESSION_TOKEN_PATTERN.test(value);
}

@Injectable()
export class SessionService {
  constructor(@Inject(AUTHORIZATION_POOL) private readonly pool: Pool) {}

  async issue(actor: AuthenticatedActor): Promise<IssuedBrowserSession> {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const tokenDigest = digestToken(token);
    const now = Date.now();
    const idleExpiresAt = new Date(now + SESSION_IDLE_TIMEOUT_MS);
    const absoluteExpiresAt = new Date(now + SESSION_ABSOLUTE_TIMEOUT_MS);
    const session = await this.withApplicationRole(async (client) => {
      const user = await client.query<{ id: string }>(
        `SELECT id
         FROM platform.app_user
         WHERE id = $1 AND status = 'active'
         FOR KEY SHARE`,
        [actor.userId],
      );

      if (user.rowCount !== 1) {
        throw new UnauthorizedException("The user account is not active.");
      }

      const result = await client.query<{ absolute_expires_at: Date }>(
        `INSERT INTO platform.browser_session
           (user_id, token_digest, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING absolute_expires_at`,
        [actor.userId, tokenDigest, idleExpiresAt, absoluteExpiresAt],
      );
      return result.rows[0];
    });

    return {
      actor,
      expiresAt: session.absolute_expires_at,
      token,
    };
  }

  async authenticate(token: string): Promise<AuthenticatedActor> {
    if (!isSessionToken(token)) {
      throw new UnauthorizedException("A valid browser session is required.");
    }

    const actor = await this.withApplicationRole(async (client) => {
      const result = await client.query<{ user_id: string }>(
        `UPDATE platform.browser_session AS session
         SET last_seen_at = now(),
             idle_expires_at = LEAST(
               session.absolute_expires_at,
               now() + ($2::double precision * interval '1 millisecond')
             )
         FROM platform.app_user AS app_user
         WHERE session.token_digest = $1
           AND session.user_id = app_user.id
           AND app_user.status = 'active'
           AND session.invalidated_at IS NULL
           AND session.idle_expires_at > now()
           AND session.absolute_expires_at > now()
         RETURNING session.user_id`,
        [digestToken(token), SESSION_IDLE_TIMEOUT_MS],
      );
      return result.rows[0];
    });

    if (!actor) {
      throw new UnauthorizedException("A valid browser session is required.");
    }

    return { userId: actor.user_id };
  }

  async invalidate(
    token: string,
    reason: SessionInvalidationReason,
  ): Promise<void> {
    if (!isSessionToken(token)) {
      return;
    }

    await this.withApplicationRole((client) =>
      client.query(
        `UPDATE platform.browser_session
         SET invalidated_at = now(), invalidated_reason = $2
         WHERE token_digest = $1 AND invalidated_at IS NULL`,
        [digestToken(token), reason],
      ),
    );
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
