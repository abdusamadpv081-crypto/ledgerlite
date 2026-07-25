import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const DEFAULTS = {
  baseCurrency: "AED",
  fiscalYearStartMonth: 1,
  timeZone: "Asia/Dubai",
};

function requireText(value, name, { maxLength, minLength = 1 } = {}) {
  if (typeof value !== "string") {
    throw new Error(`${name} is required.`);
  }
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

function optionalText(value, fallback, name, maxLength) {
  if (value === undefined || value === "") {
    return fallback;
  }
  return requireText(value, name, { maxLength });
}

export function readPilotProvisioningInput(environment = process.env) {
  const baseCurrency = optionalText(
    environment.PILOT_COMPANY_BASE_CURRENCY,
    DEFAULTS.baseCurrency,
    "PILOT_COMPANY_BASE_CURRENCY",
    3,
  ).toUpperCase();
  if (!/^[A-Z]{3}$/.test(baseCurrency)) {
    throw new Error(
      "PILOT_COMPANY_BASE_CURRENCY must be a three-letter ISO code.",
    );
  }

  const timeZone = optionalText(
    environment.PILOT_COMPANY_TIME_ZONE,
    DEFAULTS.timeZone,
    "PILOT_COMPANY_TIME_ZONE",
    64,
  );
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    throw new Error("PILOT_COMPANY_TIME_ZONE must be a valid IANA time zone.");
  }

  const fiscalYearStartMonth = Number(
    environment.PILOT_FISCAL_YEAR_START_MONTH ?? DEFAULTS.fiscalYearStartMonth,
  );
  if (
    !Number.isInteger(fiscalYearStartMonth) ||
    fiscalYearStartMonth < 1 ||
    fiscalYearStartMonth > 12
  ) {
    throw new Error(
      "PILOT_FISCAL_YEAR_START_MONTH must be an integer from 1 to 12.",
    );
  }

  return {
    baseCurrency,
    branchCode: requireText(
      environment.PILOT_BRANCH_CODE,
      "PILOT_BRANCH_CODE",
      {
        maxLength: 32,
      },
    ),
    branchName: requireText(
      environment.PILOT_BRANCH_NAME,
      "PILOT_BRANCH_NAME",
      {
        maxLength: 240,
      },
    ),
    companyLegalName: requireText(
      environment.PILOT_COMPANY_LEGAL_NAME,
      "PILOT_COMPANY_LEGAL_NAME",
      { maxLength: 240 },
    ),
    displayName: requireText(
      environment.PILOT_OWNER_DISPLAY_NAME,
      "PILOT_OWNER_DISPLAY_NAME",
      { maxLength: 240 },
    ),
    externalReference: requireText(
      environment.PILOT_PROVISIONING_REFERENCE,
      "PILOT_PROVISIONING_REFERENCE",
      { maxLength: 120, minLength: 3 },
    ),
    externalSubject: requireText(
      environment.PILOT_OWNER_EXTERNAL_SUBJECT,
      "PILOT_OWNER_EXTERNAL_SUBJECT",
      { maxLength: 500 },
    ),
    fiscalYearStartMonth,
    identityProvider: requireText(
      environment.PILOT_OWNER_IDENTITY_PROVIDER,
      "PILOT_OWNER_IDENTITY_PROVIDER",
      { maxLength: 500 },
    ),
    timeZone,
  };
}

function assertExistingProvisioningMatches(existing, input) {
  if (
    existing.identity_provider !== input.identityProvider ||
    existing.external_subject !== input.externalSubject
  ) {
    throw new Error(
      "PILOT_PROVISIONING_REFERENCE is already bound to a different owner identity.",
    );
  }
}

async function withOperatorRole(client, callback) {
  await client.query("SET LOCAL ROLE ledgerlite_operator");
  return callback();
}

export async function provisionPilotCompany({
  connectionString,
  input,
  rollbackAfterProvisioning = false,
}) {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await withOperatorRole(client, async () => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        input.externalReference,
      ]);
      const prior = await client.query(
        `SELECT provisioning.company_id, provisioning.initial_branch_id,
                provisioning.owner_user_id, owner.identity_provider,
                owner.external_subject
         FROM platform.company_provisioning AS provisioning
         JOIN platform.app_user AS owner ON owner.id = provisioning.owner_user_id
         WHERE provisioning.external_reference = $1`,
        [input.externalReference],
      );
      if (prior.rowCount === 1) {
        assertExistingProvisioningMatches(prior.rows[0], input);
        return {
          branchId: prior.rows[0].initial_branch_id,
          companyId: prior.rows[0].company_id,
          created: false,
          ownerUserId: prior.rows[0].owner_user_id,
        };
      }

      const companyId = randomUUID();
      const branchId = randomUUID();
      await client.query(
        "SELECT set_config('app.current_company_id', $1, true)",
        [companyId],
      );
      await client.query("SET LOCAL ROLE ledgerlite_app");

      const existingOwner = await client.query(
        `SELECT id, status
         FROM platform.app_user
         WHERE identity_provider = $1 AND external_subject = $2
         FOR KEY SHARE`,
        [input.identityProvider, input.externalSubject],
      );
      let ownerUserId = existingOwner.rows[0]?.id;
      if (
        existingOwner.rowCount === 1 &&
        existingOwner.rows[0].status !== "active"
      ) {
        throw new Error("The supplied owner identity is disabled.");
      }
      if (!ownerUserId) {
        ownerUserId = randomUUID();
        await client.query(
          `INSERT INTO platform.app_user
             (id, identity_provider, external_subject, display_name)
           VALUES ($1, $2, $3, $4)`,
          [
            ownerUserId,
            input.identityProvider,
            input.externalSubject,
            input.displayName,
          ],
        );
      }
      await client.query(
        "SELECT set_config('app.current_actor_id', $1, true)",
        [ownerUserId],
      );

      await client.query(
        `INSERT INTO platform.company
           (id, legal_name, base_currency, time_zone, fiscal_year_start_month)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          companyId,
          input.companyLegalName,
          input.baseCurrency,
          input.timeZone,
          input.fiscalYearStartMonth,
        ],
      );
      await client.query(
        `INSERT INTO platform.branch (id, company_id, code, name, time_zone)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          branchId,
          companyId,
          input.branchCode,
          input.branchName,
          input.timeZone,
        ],
      );
      const membership = await client.query(
        `INSERT INTO platform.company_user (company_id, user_id)
         VALUES ($1, $2)
         RETURNING id`,
        [companyId, ownerUserId],
      );
      await client.query(
        `INSERT INTO platform.role_assignment
           (company_id, company_user_id, role_template)
         VALUES ($1, $2, 'owner')`,
        [companyId, membership.rows[0].id],
      );
      await client.query(
        `INSERT INTO audit.event
           (company_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'company.provisioned', 'company', $1, $2::jsonb)`,
        [
          companyId,
          JSON.stringify({
            provisioning_reference: input.externalReference,
            source: "assisted_pilot",
          }),
        ],
      );

      await client.query("SET LOCAL ROLE ledgerlite_operator");
      await client.query(
        `INSERT INTO platform.company_provisioning
           (external_reference, company_id, initial_branch_id, owner_user_id)
         VALUES ($1, $2, $3, $4)`,
        [input.externalReference, companyId, branchId, ownerUserId],
      );

      return { branchId, companyId, created: true, ownerUserId };
    });

    await client.query(rollbackAfterProvisioning ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
