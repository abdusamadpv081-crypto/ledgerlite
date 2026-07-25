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
    ]);
    expect(
      result.rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum)),
    ).toBe(true);
  });
});
