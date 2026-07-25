import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const suffix = randomUUID();

let userId: string;
let sessionId: string;
const tokenDigest = randomBytes(32);

beforeAll(async () => {
  userId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user (identity_provider, external_subject, display_name)
       VALUES ('test-oidc', $1, 'Session test user')
       RETURNING id`,
      [`browser-session-${suffix}`],
    )
  ).rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM platform.browser_session WHERE user_id = $1", [
    userId,
  ]);
  await pool.query("DELETE FROM platform.app_user WHERE id = $1", [userId]);
  await pool.end();
});

describe("browser session schema", () => {
  it("stores only a fixed-length token digest and bounded expiry window", async () => {
    sessionId = (
      await pool.query<{ id: string }>(
        `INSERT INTO platform.browser_session
           (user_id, token_digest, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, now() + interval '15 minutes', now() + interval '8 hours')
         RETURNING id`,
        [userId, tokenDigest],
      )
    ).rows[0].id;

    await expect(
      pool.query(
        `INSERT INTO platform.browser_session
           (user_id, token_digest, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, now() + interval '15 minutes', now() + interval '8 hours')`,
        [userId, tokenDigest],
      ),
    ).rejects.toThrow(/browser_session_token_digest_key/i);

    await expect(
      pool.query(
        `INSERT INTO platform.browser_session
           (user_id, token_digest, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, now() + interval '9 hours', now() + interval '8 hours')`,
        [userId, randomBytes(32)],
      ),
    ).rejects.toThrow(/browser_session_idle_before_absolute_valid/i);
  });

  it("allows invalidation but never session reactivation", async () => {
    await pool.query(
      `UPDATE platform.browser_session
       SET invalidated_at = now(), invalidated_reason = 'logout'
       WHERE id = $1`,
      [sessionId],
    );

    await expect(
      pool.query(
        "UPDATE platform.browser_session SET invalidated_at = NULL, invalidated_reason = NULL WHERE id = $1",
        [sessionId],
      ),
    ).rejects.toThrow(/cannot be reactivated/i);
  });
});
