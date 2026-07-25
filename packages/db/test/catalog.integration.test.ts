import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const suffix = randomUUID();
let companyAId: string;
let companyBId: string;
let branchAId: string;
let productAId: string;
let taxAId: string;

async function asCompany<T>(
  companyId: string,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.current_company_id', $1, true)",
      [companyId],
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
  const companies = await pool.query<{ id: string }>(
    "INSERT INTO platform.company (legal_name) VALUES ($1), ($2) RETURNING id",
    [`Catalog A ${suffix}`, `Catalog B ${suffix}`],
  );
  companyAId = companies.rows[0].id;
  companyBId = companies.rows[1].id;
  const branch = await pool.query<{ id: string }>(
    "INSERT INTO platform.branch (company_id, code, name) VALUES ($1, 'MAIN', 'Main') RETURNING id",
    [companyAId],
  );
  branchAId = branch.rows[0].id;
  const tax = await pool.query<{ id: string }>(
    "INSERT INTO catalog.tax_code (company_id, code, name, rate) VALUES ($1, 'VAT5', 'VAT 5%', 0.05) RETURNING id",
    [companyAId],
  );
  taxAId = tax.rows[0].id;
  const product = await pool.query<{ id: string }>(
    "INSERT INTO catalog.product (company_id, sku, name, default_tax_code_id) VALUES ($1, 'SKU-1', 'Product A', $2) RETURNING id",
    [companyAId, taxAId],
  );
  productAId = product.rows[0].id;
  await pool.query(
    "INSERT INTO catalog.product_branch (company_id, product_id, branch_id) VALUES ($1, $2, $3)",
    [companyAId, productAId, branchAId],
  );
  const priceList = await pool.query<{ id: string }>(
    "INSERT INTO catalog.price_list (company_id, name) VALUES ($1, 'Retail') RETURNING id",
    [companyAId],
  );
  await pool.query(
    "INSERT INTO catalog.price_list_item (company_id, price_list_id, product_id, unit_price) VALUES ($1, $2, $3, 10.50)",
    [companyAId, priceList.rows[0].id, productAId],
  );
  await pool.query(
    "INSERT INTO platform.policy_version (company_id, version) VALUES ($1, 1)",
    [companyAId],
  );
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM platform.policy_version WHERE company_id IN ($1, $2)",
    [companyAId, companyBId],
  );
  await pool.query(
    "DELETE FROM catalog.price_list_item WHERE company_id IN ($1, $2)",
    [companyAId, companyBId],
  );
  await pool.query(
    "DELETE FROM catalog.price_list WHERE company_id IN ($1, $2)",
    [companyAId, companyBId],
  );
  await pool.query(
    "DELETE FROM catalog.product_branch WHERE company_id IN ($1, $2)",
    [companyAId, companyBId],
  );
  await pool.query(
    "DELETE FROM catalog.product_barcode WHERE company_id IN ($1, $2)",
    [companyAId, companyBId],
  );
  await pool.query("DELETE FROM catalog.product WHERE company_id IN ($1, $2)", [
    companyAId,
    companyBId,
  ]);
  await pool.query(
    "DELETE FROM catalog.tax_code WHERE company_id IN ($1, $2)",
    [companyAId, companyBId],
  );
  await pool.query("DELETE FROM platform.branch WHERE company_id IN ($1, $2)", [
    companyAId,
    companyBId,
  ]);
  await pool.query("DELETE FROM platform.company WHERE id IN ($1, $2)", [
    companyAId,
    companyBId,
  ]);
  await pool.end();
});

describe("catalogue and policy tenant isolation", () => {
  it("forces row security on every tenant-owned catalogue table", async () => {
    const result = await pool.query<{
      relname: string;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relforcerowsecurity
       FROM pg_class
       JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
       WHERE (nspname = 'catalog' AND relname IN ('tax_code', 'product', 'product_barcode', 'product_branch', 'price_list', 'price_list_item'))
          OR (nspname = 'platform' AND relname = 'policy_version')
       ORDER BY relname`,
    );

    expect(result.rows).toHaveLength(7);
    expect(result.rows.every((row) => row.relforcerowsecurity)).toBe(true);
  });

  it("exposes only the current company's product, price, and policy read model", async () => {
    const visible = await asCompany(companyAId, async (client) => ({
      products: await client.query("SELECT id FROM catalog.product"),
      prices: await client.query(
        "SELECT unit_price::text FROM catalog.price_list_item",
      ),
      policies: await client.query(
        "SELECT offline_max_hours FROM platform.policy_version",
      ),
    }));

    expect(visible.products.rows).toEqual([{ id: productAId }]);
    expect(visible.prices.rows).toEqual([{ unit_price: "10.500000" }]);
    expect(visible.policies.rows).toEqual([{ offline_max_hours: 72 }]);
  });

  it("rejects a product that references another company's tax code", async () => {
    await expect(
      asCompany(companyBId, (client) =>
        client.query(
          "INSERT INTO catalog.product (company_id, name, default_tax_code_id) VALUES ($1, 'Invalid', $2)",
          [companyBId, taxAId],
        ),
      ),
    ).rejects.toThrow();
  });

  it("maintains updated_at for a mutable catalogue record", async () => {
    const before = await pool.query<{ updated_at: Date }>(
      "SELECT updated_at FROM catalog.product WHERE id = $1",
      [productAId],
    );

    const after = await asCompany(companyAId, (client) =>
      client.query<{ updated_at: Date }>(
        "UPDATE catalog.product SET name = 'Product A updated' WHERE id = $1 RETURNING updated_at",
        [productAId],
      ),
    );

    expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(
      before.rows[0].updated_at.getTime(),
    );
  });
});
