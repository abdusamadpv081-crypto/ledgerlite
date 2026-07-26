import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const suffix = randomUUID();
const requestHash = createHash("sha256").update("first request").digest();
const differentRequestHash = createHash("sha256")
  .update("different request")
  .digest();

let companyId: string;
let userId: string;

async function asActor<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.current_company_id', $1, true)",
      [companyId],
    );
    await client.query("SELECT set_config('app.current_actor_id', $1, true)", [
      userId,
    ]);
    await client.query(
      "SELECT set_config('app.current_correlation_id', $1, true)",
      [randomUUID()],
    );
    await client.query("SET LOCAL ROLE ledgerlite_app");
    const result = await callback(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  userId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user (identity_provider, external_subject, display_name)
       VALUES ('test-oidc', $1, 'Command actor')
       RETURNING id`,
      [`command-actor-${suffix}`],
    )
  ).rows[0].id;
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Command company ${suffix}`],
    )
  ).rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM platform.company WHERE id = $1", [companyId]);
  await pool.query("DELETE FROM platform.app_user WHERE id = $1", [userId]);
  await pool.end();
});

describe("online command integrity", () => {
  it("records one audit event and safely handles command retries", async () => {
    await asActor(async (client) => {
      const first = await client.query<{
        is_new: boolean;
        response: unknown;
        correlation_id: string;
      }>("SELECT * FROM platform.acquire_command_idempotency($1, $2, $3, $4)", [
        "branch.create",
        "command-key-1",
        requestHash,
        randomUUID(),
      ]);
      expect(first.rows[0]).toMatchObject({ is_new: true, response: null });

      const audit = await client.query<{ event_id: string }>(
        "SELECT audit.write_event($1, $2, $3, $4, $5) AS event_id",
        [
          companyId,
          "branch.created",
          "platform.branch",
          randomUUID(),
          { code: "SECOND" },
        ],
      );
      expect(audit.rows[0].event_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      await client.query(
        "SELECT platform.complete_command_idempotency($1, $2, $3)",
        ["branch.create", "command-key-1", { branchId: "response-id" }],
      );

      const replay = await client.query<{
        is_new: boolean;
        response: { branchId: string };
        correlation_id: string;
      }>("SELECT * FROM platform.acquire_command_idempotency($1, $2, $3, $4)", [
        "branch.create",
        "command-key-1",
        requestHash,
        randomUUID(),
      ]);
      expect(replay.rows[0]).toMatchObject({
        is_new: false,
        response: { branchId: "response-id" },
      });
      expect(replay.rows[0].correlation_id).toBe(first.rows[0].correlation_id);

      await expect(
        client.query(
          "SELECT * FROM platform.acquire_command_idempotency($1, $2, $3, $4)",
          [
            "branch.create",
            "command-key-1",
            differentRequestHash,
            randomUUID(),
          ],
        ),
      ).rejects.toThrow(/different request/i);
    });
  });

  it("does not allow an actor to write a command record for another actor", async () => {
    await expect(
      asActor((client) =>
        client.query(
          `INSERT INTO platform.command_idempotency
             (company_id, actor_user_id, command, idempotency_key, request_hash, correlation_id)
           VALUES ($1, $2, 'branch.create', 'command-key-2', $3, $4)`,
          [companyId, randomUUID(), requestHash, randomUUID()],
        ),
      ),
    ).rejects.toThrow();
  });
});
