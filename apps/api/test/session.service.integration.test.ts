import { randomUUID } from "node:crypto";

import { UnauthorizedException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { SessionService } from "../src/auth/session.service.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const sessions = new SessionService(pool);
const suffix = randomUUID();

let activeUserId: string;
let disabledUserId: string;

beforeAll(async () => {
  const users = await pool.query<{ id: string }>(
    `INSERT INTO platform.app_user
       (identity_provider, external_subject, display_name, status)
     VALUES
       ('test-oidc', $1, 'Active session user', 'active'),
       ('test-oidc', $2, 'Disabled session user', 'disabled')
     RETURNING id`,
    [`active-session-${suffix}`, `disabled-session-${suffix}`],
  );
  [activeUserId, disabledUserId] = users.rows.map((row) => row.id);
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM platform.browser_session WHERE user_id IN ($1, $2)",
    [activeUserId, disabledUserId],
  );
  await pool.query("DELETE FROM platform.app_user WHERE id IN ($1, $2)", [
    activeUserId,
    disabledUserId,
  ]);
  await pool.end();
});

describe("SessionService", () => {
  it("issues an opaque session token and resolves the active actor", async () => {
    const issued = await sessions.issue({ userId: activeUserId });

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
    await expect(sessions.authenticate(issued.token)).resolves.toEqual({
      userId: activeUserId,
    });

    const stored = await pool.query<{ digest_length: number }>(
      `SELECT octet_length(token_digest) AS digest_length
       FROM platform.browser_session
       WHERE user_id = $1`,
      [activeUserId],
    );
    expect(stored.rows).toEqual([{ digest_length: 32 }]);
  });

  it("denies malformed, revoked, and disabled-user sessions", async () => {
    await expect(
      sessions.authenticate("not-a-session-token"),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const issued = await sessions.issue({ userId: activeUserId });
    await sessions.invalidate(issued.token, "logout");
    await expect(sessions.authenticate(issued.token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    await expect(
      sessions.issue({ userId: disabledUserId }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const issuedForLaterDisabledUser = await sessions.issue({
      userId: activeUserId,
    });
    await pool.query(
      "UPDATE platform.app_user SET status = 'disabled' WHERE id = $1",
      [activeUserId],
    );
    await expect(
      sessions.authenticate(issuedForLaterDisabledUser.token),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
