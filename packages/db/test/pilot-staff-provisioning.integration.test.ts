import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { provisionPilotStaffAccess } from "../scripts/pilot-staff-provisioning.mjs";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite";
const pool = new Pool({ connectionString });
const suffix = randomUUID();
const grantReference = `STAFF-GRANT-${suffix}`;
const revokeReference = `STAFF-REVOKE-${suffix}`;
let companyId: string;
let branchId: string;
let userId: string;
let roleAssignmentId: string;

beforeAll(async () => {
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Staff provisioning ${suffix}`],
    )
  ).rows[0].id;
  branchId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.branch (company_id, code, name)
       VALUES ($1, 'MAIN', 'Main branch') RETURNING id`,
      [companyId],
    )
  ).rows[0].id;
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      "DELETE FROM platform.staff_access_provisioning WHERE company_id = $1",
      [companyId],
    );
    await client.query("DELETE FROM audit.event WHERE company_id = $1", [
      companyId,
    ]);
    await client.query(
      "DELETE FROM platform.role_assignment WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM platform.company_user WHERE company_id = $1",
      [companyId],
    );
    await client.query("DELETE FROM platform.branch WHERE company_id = $1", [
      companyId,
    ]);
    if (userId)
      await client.query("DELETE FROM platform.app_user WHERE id = $1", [
        userId,
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

describe("assisted pilot staff provisioning", () => {
  it("grants and revokes a branch-scoped role idempotently with audit evidence", async () => {
    const input = {
      action: "grant",
      branchId,
      companyId,
      displayName: "Pilot cashier",
      externalReference: grantReference,
      externalSubject: `cashier-${suffix}`,
      identityProvider: "https://identity.ledgerlite.test/",
      roleTemplate: "cashier",
    };
    const granted = await provisionPilotStaffAccess({
      connectionString,
      input,
    });
    const retriedGrant = await provisionPilotStaffAccess({
      connectionString,
      input,
    });
    userId = granted.userId;
    roleAssignmentId = granted.roleAssignmentId;

    expect(granted).toMatchObject({
      accessAction: "grant",
      branchId,
      changed: true,
      companyId,
    });
    expect(retriedGrant).toEqual({ ...granted, changed: false });

    const revoked = await provisionPilotStaffAccess({
      connectionString,
      input: {
        ...input,
        action: "revoke",
        displayName: undefined,
        externalReference: revokeReference,
      },
    });
    const retriedRevoke = await provisionPilotStaffAccess({
      connectionString,
      input: {
        ...input,
        action: "revoke",
        displayName: undefined,
        externalReference: revokeReference,
      },
    });

    expect(revoked).toMatchObject({
      accessAction: "revoke",
      branchId,
      changed: true,
      companyId,
      roleAssignmentId,
      userId,
    });
    expect(retriedRevoke).toEqual({ ...revoked, changed: false });

    const [assignment, records, audit] = await Promise.all([
      pool.query<{ effective_until: Date | null }>(
        "SELECT effective_until FROM platform.role_assignment WHERE id = $1",
        [roleAssignmentId],
      ),
      pool.query<{ action: string }>(
        `SELECT action FROM platform.staff_access_provisioning
         WHERE company_id = $1 ORDER BY created_at`,
        [companyId],
      ),
      pool.query<{ action: string; correlation_id: string | null }>(
        `SELECT action, correlation_id::text FROM audit.event
         WHERE company_id = $1 ORDER BY occurred_at`,
        [companyId],
      ),
    ]);
    expect(assignment.rows[0].effective_until).not.toBeNull();
    expect(records.rows).toEqual([{ action: "grant" }, { action: "revoke" }]);
    expect(audit.rows.map((event) => event.action)).toEqual([
      "access.granted",
      "access.revoked",
    ]);
    expect(audit.rows.every((event) => event.correlation_id !== null)).toBe(
      true,
    );
  });

  it("keeps operator tickets unavailable to the runtime application role", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE ledgerlite_app");
      await expect(
        client.query("SELECT * FROM platform.staff_access_provisioning"),
      ).rejects.toThrow(/permission denied/i);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
