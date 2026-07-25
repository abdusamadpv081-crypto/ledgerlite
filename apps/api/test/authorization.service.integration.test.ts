import { randomUUID } from "node:crypto";

import { ForbiddenException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { AuthorizationService } from "../src/auth/authorization.service.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const authorization = new AuthorizationService(pool);
const suffix = randomUUID();

let companyAId: string;
let companyBId: string;
let branchAId: string;
let branchBId: string;
let foreignBranchId: string;
let ownerUserId: string;
let managerUserId: string;
let cashierUserId: string;

beforeAll(async () => {
  const users = await pool.query<{ id: string }>(
    `INSERT INTO platform.app_user (identity_provider, external_subject, display_name)
     VALUES
       ('test-oidc', $1, 'Owner'),
       ('test-oidc', $2, 'Manager'),
       ('test-oidc', $3, 'Cashier')
     RETURNING id`,
    [`owner-${suffix}`, `manager-${suffix}`, `cashier-${suffix}`],
  );
  [ownerUserId, managerUserId, cashierUserId] = users.rows.map((row) => row.id);

  const companies = await pool.query<{ id: string }>(
    `INSERT INTO platform.company (legal_name)
     VALUES ($1), ($2)
     RETURNING id`,
    [`Authorization A ${suffix}`, `Authorization B ${suffix}`],
  );
  [companyAId, companyBId] = companies.rows.map((row) => row.id);

  const branches = await pool.query<{ id: string }>(
    `INSERT INTO platform.branch (company_id, code, name)
     VALUES ($1, 'A1', 'Branch A'), ($1, 'A2', 'Branch B')
     RETURNING id`,
    [companyAId],
  );
  [branchAId, branchBId] = branches.rows.map((row) => row.id);

  foreignBranchId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.branch (company_id, code, name)
       VALUES ($1, 'B1', 'Foreign branch')
       RETURNING id`,
      [companyBId],
    )
  ).rows[0].id;

  await pool.query(
    `INSERT INTO platform.company_user (company_id, user_id)
     VALUES ($1, $2), ($1, $3), ($1, $4)`,
    [companyAId, ownerUserId, managerUserId, cashierUserId],
  );
  await pool.query(
    `INSERT INTO platform.role_assignment
     (company_id, company_user_id, branch_id, role_template)
     SELECT company_id, id,
       CASE WHEN user_id = $2 THEN NULL::uuid ELSE $3::uuid END,
       CASE
         WHEN user_id = $2 THEN 'owner'
         WHEN user_id = $4 THEN 'branch_manager'
         ELSE 'cashier'
       END
     FROM platform.company_user
     WHERE company_id = $1`,
    [companyAId, ownerUserId, branchAId, managerUserId],
  );
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM platform.role_assignment WHERE company_id IN ($1, $2)",
    [companyAId, companyBId],
  );
  await pool.query(
    "DELETE FROM platform.company_user WHERE company_id IN ($1, $2)",
    [companyAId, companyBId],
  );
  await pool.query("DELETE FROM platform.branch WHERE company_id = $1", [
    companyAId,
  ]);
  await pool.query("DELETE FROM platform.branch WHERE company_id = $1", [
    companyBId,
  ]);
  await pool.query("DELETE FROM platform.company WHERE id IN ($1, $2)", [
    companyAId,
    companyBId,
  ]);
  await pool.query("DELETE FROM platform.app_user WHERE id IN ($1, $2, $3)", [
    ownerUserId,
    managerUserId,
    cashierUserId,
  ]);
  await pool.end();
});

describe("AuthorizationService", () => {
  it("grants a company owner company-wide catalogue authority", async () => {
    await expect(
      authorization.assertCapability(
        { actorUserId: ownerUserId, companyId: companyAId },
        "catalog.manage",
      ),
    ).resolves.toBeUndefined();
  });

  it("grants a branch manager only within the assigned branch", async () => {
    await expect(
      authorization.assertCapability(
        {
          actorUserId: managerUserId,
          companyId: companyAId,
          branchId: branchAId,
        },
        "inventory.manage",
      ),
    ).resolves.toBeUndefined();

    await expect(
      authorization.assertCapability(
        {
          actorUserId: managerUserId,
          companyId: companyAId,
          branchId: branchBId,
        },
        "inventory.manage",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("denies cashier configuration access and every cross-company request", async () => {
    await expect(
      authorization.assertCapability(
        {
          actorUserId: cashierUserId,
          companyId: companyAId,
          branchId: branchAId,
        },
        "catalog.manage",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      authorization.assertCapability(
        { actorUserId: ownerUserId, companyId: companyBId },
        "catalog.manage",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      authorization.assertCapability(
        {
          actorUserId: ownerUserId,
          companyId: companyAId,
          branchId: foreignBranchId,
        },
        "inventory.manage",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("denies a disabled user even when an active role assignment remains", async () => {
    await pool.query(
      "UPDATE platform.app_user SET status = 'disabled' WHERE id = $1",
      [cashierUserId],
    );

    await expect(
      authorization.assertCapability(
        {
          actorUserId: cashierUserId,
          companyId: companyAId,
          branchId: branchAId,
        },
        "pos.sale.create",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
