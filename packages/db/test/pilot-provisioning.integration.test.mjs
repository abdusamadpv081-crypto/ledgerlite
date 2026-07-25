import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  provisionPilotCompany,
  readPilotProvisioningInput,
} from "../scripts/pilot-provisioning.mjs";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite";
const pool = new Pool({ connectionString });
const suffix = randomUUID();
const ownerIdentityProvider = "https://identity.ledgerlite.test/";
const ownerExternalSubject = `pilot-owner-${suffix}`;
const idempotentReference = `OPS-IDEMPOTENT-${suffix}`;

let existingCompanyId;
let existingBranchId;
let existingOwnerUserId;

function pilotInput(reference) {
  return {
    baseCurrency: "AED",
    branchCode: "MAIN",
    branchName: "Main branch",
    companyLegalName: `Pilot company ${suffix}`,
    displayName: "Pilot owner",
    externalReference: reference,
    externalSubject: ownerExternalSubject,
    fiscalYearStartMonth: 1,
    identityProvider: ownerIdentityProvider,
    timeZone: "Asia/Dubai",
  };
}

beforeAll(async () => {
  existingOwnerUserId = (
    await pool.query(
      `INSERT INTO platform.app_user
         (identity_provider, external_subject, display_name)
       VALUES ($1, $2, 'Existing pilot owner')
       RETURNING id`,
      [ownerIdentityProvider, ownerExternalSubject],
    )
  ).rows[0].id;
  existingCompanyId = (
    await pool.query(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Existing pilot company ${suffix}`],
    )
  ).rows[0].id;
  existingBranchId = (
    await pool.query(
      `INSERT INTO platform.branch (company_id, code, name)
       VALUES ($1, 'MAIN', 'Main branch')
       RETURNING id`,
      [existingCompanyId],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO platform.company_provisioning
       (external_reference, company_id, initial_branch_id, owner_user_id)
     VALUES ($1, $2, $3, $4)`,
    [
      idempotentReference,
      existingCompanyId,
      existingBranchId,
      existingOwnerUserId,
    ],
  );
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM platform.company_provisioning WHERE external_reference = $1",
    [idempotentReference],
  );
  await pool.query("DELETE FROM platform.branch WHERE id = $1", [
    existingBranchId,
  ]);
  await pool.query("DELETE FROM platform.company WHERE id = $1", [
    existingCompanyId,
  ]);
  await pool.query("DELETE FROM platform.app_user WHERE id = $1", [
    existingOwnerUserId,
  ]);
  await pool.end();
});

describe("pilot owner provisioning command", () => {
  it("creates the full owner/company/branch/audit path atomically in dry-run mode", async () => {
    const reference = `OPS-DRY-RUN-${suffix}`;
    const result = await provisionPilotCompany({
      connectionString,
      input: pilotInput(reference),
      rollbackAfterProvisioning: true,
    });

    expect(result.created).toBe(true);
    expect(result.companyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    await expect(
      pool.query(
        "SELECT id FROM platform.company_provisioning WHERE external_reference = $1",
        [reference],
      ),
    ).resolves.toMatchObject({ rows: [] });
  });

  it("returns the existing record for a repeated operations reference", async () => {
    const result = await provisionPilotCompany({
      connectionString,
      input: pilotInput(idempotentReference),
      rollbackAfterProvisioning: true,
    });

    expect(result).toEqual({
      branchId: existingBranchId,
      companyId: existingCompanyId,
      created: false,
      ownerUserId: existingOwnerUserId,
    });
  });

  it("rejects incomplete environment input before opening a database transaction", () => {
    expect(() => readPilotProvisioningInput({})).toThrow(
      /PILOT_COMPANY_BASE_CURRENCY|PILOT_BRANCH_CODE/i,
    );
  });
});
