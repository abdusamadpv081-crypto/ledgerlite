import { randomUUID } from "node:crypto";
import process from "node:process";
import { Pool } from "pg";

const ROLE_TEMPLATES = new Set(["accountant", "branch_manager", "cashier"]);

function requireText(value, name, { maxLength, minLength = 1 } = {}) {
  if (typeof value !== "string") throw new Error(`${name} is required.`);
  const normalized = value.trim();
  if (
    normalized.length < minLength ||
    (maxLength !== undefined && normalized.length > maxLength)
  ) {
    throw new Error(
      `${name} must be between ${minLength} and ${maxLength} characters.`,
    );
  }
  return normalized;
}

function requireUuid(value, name) {
  const normalized = requireText(value, name, { maxLength: 36 });
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  ) {
    throw new Error(`${name} must be a UUID.`);
  }
  return normalized;
}

function optionalUuid(value, name) {
  if (value === undefined || value.trim() === "") return undefined;
  return requireUuid(value, name);
}

export function readPilotStaffProvisioningInput(environment = process.env) {
  const action = requireText(
    environment.PILOT_STAFF_ACCESS_ACTION,
    "PILOT_STAFF_ACCESS_ACTION",
    { maxLength: 16 },
  );
  if (action !== "grant" && action !== "revoke") {
    throw new Error("PILOT_STAFF_ACCESS_ACTION must be grant or revoke.");
  }
  const roleTemplate = requireText(
    environment.PILOT_STAFF_ROLE,
    "PILOT_STAFF_ROLE",
    { maxLength: 32 },
  );
  if (!ROLE_TEMPLATES.has(roleTemplate)) {
    throw new Error(
      "PILOT_STAFF_ROLE must be accountant, branch_manager, or cashier.",
    );
  }

  const branchId = optionalUuid(
    environment.PILOT_STAFF_BRANCH_ID,
    "PILOT_STAFF_BRANCH_ID",
  );
  if (roleTemplate === "accountant" && branchId !== undefined) {
    throw new Error("PILOT_STAFF_BRANCH_ID is not allowed for an accountant.");
  }
  if (roleTemplate !== "accountant" && branchId === undefined) {
    throw new Error(
      "PILOT_STAFF_BRANCH_ID is required for branch_manager and cashier roles.",
    );
  }

  return {
    action,
    branchId,
    companyId: requireUuid(
      environment.PILOT_STAFF_COMPANY_ID,
      "PILOT_STAFF_COMPANY_ID",
    ),
    displayName:
      action === "grant"
        ? requireText(
            environment.PILOT_STAFF_DISPLAY_NAME,
            "PILOT_STAFF_DISPLAY_NAME",
            { maxLength: 240 },
          )
        : undefined,
    externalReference: requireText(
      environment.PILOT_STAFF_PROVISIONING_REFERENCE,
      "PILOT_STAFF_PROVISIONING_REFERENCE",
      { maxLength: 120, minLength: 3 },
    ),
    externalSubject: requireText(
      environment.PILOT_STAFF_EXTERNAL_SUBJECT,
      "PILOT_STAFF_EXTERNAL_SUBJECT",
      { maxLength: 500 },
    ),
    identityProvider: requireText(
      environment.PILOT_STAFF_IDENTITY_PROVIDER,
      "PILOT_STAFF_IDENTITY_PROVIDER",
      { maxLength: 500 },
    ),
    roleTemplate,
  };
}

function assertExistingProvisioningMatches(existing, input) {
  if (
    existing.action !== input.action ||
    existing.company_id !== input.companyId ||
    existing.identity_provider !== input.identityProvider ||
    existing.external_subject !== input.externalSubject ||
    existing.role_template !== input.roleTemplate ||
    existing.branch_id !== (input.branchId ?? null)
  ) {
    throw new Error(
      "PILOT_STAFF_PROVISIONING_REFERENCE is already bound to different access details.",
    );
  }
}

async function insertAuditEvent(client, event) {
  await client.query(
    `INSERT INTO audit.event
       (company_id, action, entity_type, entity_id, correlation_id, metadata)
     VALUES ($1, $2, 'platform.role_assignment', $3, $4, $5::jsonb)`,
    [
      event.companyId,
      event.action,
      event.roleAssignmentId,
      randomUUID(),
      JSON.stringify({
        access_action: event.accessAction,
        branch_id: event.branchId,
        provisioning_reference: event.externalReference,
        role_template: event.roleTemplate,
        source: "assisted_pilot",
        user_id: event.userId,
      }),
    ],
  );
}

export async function provisionPilotStaffAccess({
  connectionString,
  input,
  rollbackAfterProvisioning = false,
}) {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE ledgerlite_operator");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      input.externalReference,
    ]);
    const prior = await client.query(
      `SELECT provisioning.action, provisioning.company_id,
              provisioning.role_assignment_id, provisioning.role_template,
              provisioning.branch_id, provisioning.user_id,
              app_user.identity_provider, app_user.external_subject
       FROM platform.staff_access_provisioning AS provisioning
       JOIN platform.app_user ON app_user.id = provisioning.user_id
       WHERE provisioning.external_reference = $1`,
      [input.externalReference],
    );
    if (prior.rowCount === 1) {
      assertExistingProvisioningMatches(prior.rows[0], input);
      await client.query(rollbackAfterProvisioning ? "ROLLBACK" : "COMMIT");
      return {
        accessAction: prior.rows[0].action,
        branchId: prior.rows[0].branch_id,
        changed: false,
        companyId: prior.rows[0].company_id,
        roleAssignmentId: prior.rows[0].role_assignment_id,
        userId: prior.rows[0].user_id,
      };
    }

    await client.query(
      "SELECT set_config('app.current_company_id', $1, true)",
      [input.companyId],
    );
    await client.query("SET LOCAL ROLE ledgerlite_app");
    const company = await client.query(
      "SELECT id FROM platform.company WHERE id = $1",
      [input.companyId],
    );
    if (company.rowCount !== 1) throw new Error("The company was not found.");

    const existingUser = await client.query(
      `SELECT id, status FROM platform.app_user
       WHERE identity_provider = $1 AND external_subject = $2 FOR KEY SHARE`,
      [input.identityProvider, input.externalSubject],
    );
    if (
      existingUser.rowCount === 1 &&
      existingUser.rows[0].status !== "active"
    ) {
      throw new Error("The supplied staff identity is disabled.");
    }
    if (input.action === "revoke" && existingUser.rowCount !== 1) {
      throw new Error("The supplied staff identity is not provisioned.");
    }
    const userId =
      existingUser.rows[0]?.id ??
      (
        await client.query(
          `INSERT INTO platform.app_user
             (id, identity_provider, external_subject, display_name)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [
            randomUUID(),
            input.identityProvider,
            input.externalSubject,
            input.displayName,
          ],
        )
      ).rows[0].id;

    if (input.branchId !== undefined) {
      const branch = await client.query(
        "SELECT id, status FROM platform.branch WHERE id = $1",
        [input.branchId],
      );
      if (branch.rowCount !== 1 || branch.rows[0].status !== "active") {
        throw new Error("The assigned branch was not found or is not active.");
      }
    }

    let membership = await client.query(
      `SELECT id, status FROM platform.company_user
       WHERE company_id = $1 AND user_id = $2 FOR KEY SHARE`,
      [input.companyId, userId],
    );
    if (membership.rowCount === 0 && input.action === "grant") {
      membership = await client.query(
        `INSERT INTO platform.company_user (company_id, user_id)
         VALUES ($1, $2) RETURNING id, status`,
        [input.companyId, userId],
      );
    }
    if (membership.rowCount !== 1 || membership.rows[0].status !== "active") {
      throw new Error("The staff membership is not active.");
    }

    const activeRole = await client.query(
      `SELECT id, effective_from FROM platform.role_assignment
       WHERE company_id = $1 AND company_user_id = $2
         AND role_template = $3 AND branch_id IS NOT DISTINCT FROM $4::uuid
         AND effective_from <= clock_timestamp()
         AND (effective_until IS NULL OR effective_until > clock_timestamp())
       FOR UPDATE`,
      [
        input.companyId,
        membership.rows[0].id,
        input.roleTemplate,
        input.branchId ?? null,
      ],
    );
    if (input.action === "grant" && activeRole.rowCount !== 0) {
      throw new Error("The requested staff role is already active.");
    }
    if (input.action === "revoke" && activeRole.rowCount !== 1) {
      throw new Error("The requested staff role is not active.");
    }

    const roleAssignmentId =
      input.action === "grant"
        ? (
            await client.query(
              `INSERT INTO platform.role_assignment
                 (company_id, company_user_id, branch_id, role_template)
               VALUES ($1, $2, $3, $4) RETURNING id`,
              [
                input.companyId,
                membership.rows[0].id,
                input.branchId ?? null,
                input.roleTemplate,
              ],
            )
          ).rows[0].id
        : (
            await client.query(
              `UPDATE platform.role_assignment
                 SET effective_until = GREATEST(
                   clock_timestamp(),
                   effective_from + interval '1 microsecond'
                 )
               WHERE id = $1 RETURNING id`,
              [activeRole.rows[0].id],
            )
          ).rows[0].id;

    await insertAuditEvent(client, {
      accessAction: input.action,
      action: input.action === "grant" ? "access.granted" : "access.revoked",
      branchId: input.branchId ?? null,
      companyId: input.companyId,
      externalReference: input.externalReference,
      roleAssignmentId,
      roleTemplate: input.roleTemplate,
      userId,
    });

    await client.query("SET LOCAL ROLE ledgerlite_operator");
    await client.query(
      `INSERT INTO platform.staff_access_provisioning
         (external_reference, action, company_id, user_id, role_assignment_id, role_template, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.externalReference,
        input.action,
        input.companyId,
        userId,
        roleAssignmentId,
        input.roleTemplate,
        input.branchId ?? null,
      ],
    );

    await client.query(rollbackAfterProvisioning ? "ROLLBACK" : "COMMIT");
    return {
      accessAction: input.action,
      branchId: input.branchId ?? null,
      changed: true,
      companyId: input.companyId,
      roleAssignmentId,
      userId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
