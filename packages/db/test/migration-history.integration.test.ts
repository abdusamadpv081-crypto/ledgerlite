import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});

afterAll(async () => {
  await pool.end();
});

describe("database migration ledger", () => {
  it("records every reviewed migration with a SHA-256 checksum", async () => {
    const result = await pool.query<{
      filename: string;
      checksum: string;
    }>(
      "SELECT filename, checksum FROM platform.schema_migration ORDER BY filename",
    );

    expect(result.rows.map((row) => row.filename)).toEqual([
      "000001_base_schemas.sql",
      "000002_platform_tenancy.sql",
      "000003_identity_membership_audit.sql",
      "000004_catalog_and_pos_policies.sql",
      "000005_catalog_prices.sql",
      "000006_force_catalog_row_security.sql",
      "000007_maintain_updated_at.sql",
      "000008_allow_multiple_unassigned_skus.sql",
      "000009_require_branch_role_scopes.sql",
      "000010_browser_sessions.sql",
      "000011_oidc_login_transactions.sql",
      "000012_operator_company_provisioning.sql",
      "000013_command_idempotency_and_audit_writer.sql",
      "000014_price_list_tax_treatment.sql",
      "000015_active_company_contexts.sql",
      "000016_operator_staff_access_provisioning.sql",
      "000017_accounting_core.sql",
      "000018_fix_manual_journal_source_uniqueness.sql",
      "000019_protect_fiscal_period_closure.sql",
    ]);
    expect(
      result.rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum)),
    ).toBe(true);
  });
});
