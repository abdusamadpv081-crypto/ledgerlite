import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});

const stateDigest = randomBytes(32);
const cipherText = randomBytes(64);
let transactionId: string;

afterAll(async () => {
  if (transactionId) {
    await pool.query(
      "DELETE FROM platform.oidc_login_transaction WHERE id = $1",
      [transactionId],
    );
  }
  await pool.end();
});

describe("OIDC login transaction schema", () => {
  it("stores a one-time encrypted PKCE transaction with a safe return path", async () => {
    transactionId = (
      await pool.query<{ id: string }>(
        `INSERT INTO platform.oidc_login_transaction
           (state_digest, code_verifier_ciphertext, nonce_ciphertext, return_to, expires_at)
         VALUES ($1, $2, $3, '/pos', now() + interval '10 minutes')
         RETURNING id`,
        [stateDigest, cipherText, cipherText],
      )
    ).rows[0].id;

    await expect(
      pool.query(
        `INSERT INTO platform.oidc_login_transaction
           (state_digest, code_verifier_ciphertext, nonce_ciphertext, expires_at)
         VALUES ($1, $2, $3, now() + interval '10 minutes')`,
        [stateDigest, cipherText, cipherText],
      ),
    ).rejects.toThrow(/oidc_login_transaction_state_digest_key/i);

    await expect(
      pool.query(
        `INSERT INTO platform.oidc_login_transaction
           (state_digest, code_verifier_ciphertext, nonce_ciphertext, return_to, expires_at)
         VALUES ($1, $2, $3, '//external.example', now() + interval '10 minutes')`,
        [randomBytes(32), cipherText, cipherText],
      ),
    ).rejects.toThrow(/oidc_login_transaction_return_to_valid/i);
  });

  it("can be consumed once but never reused or altered", async () => {
    await pool.query(
      "UPDATE platform.oidc_login_transaction SET consumed_at = now() WHERE id = $1",
      [transactionId],
    );

    await expect(
      pool.query(
        "UPDATE platform.oidc_login_transaction SET consumed_at = NULL WHERE id = $1",
        [transactionId],
      ),
    ).rejects.toThrow(/consumed OIDC login transaction .* immutable/i);
  });
});
