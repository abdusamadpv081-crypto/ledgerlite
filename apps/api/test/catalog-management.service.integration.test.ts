import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { CatalogManagementService } from "../src/catalog/catalog-management.service.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://ledgerlite:ledgerlite@localhost:5432/ledgerlite",
});
const catalogue = new CatalogManagementService(pool);
const suffix = randomUUID();
let companyId: string;
let branchId: string;
let actorUserId: string;

beforeAll(async () => {
  companyId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
      [`Catalogue service ${suffix}`],
    )
  ).rows[0].id;
  branchId = (
    await pool.query<{ id: string }>(
      "INSERT INTO platform.branch (company_id, code, name) VALUES ($1, 'MAIN', 'Main') RETURNING id",
      [companyId],
    )
  ).rows[0].id;
  actorUserId = (
    await pool.query<{ id: string }>(
      `INSERT INTO platform.app_user
       (identity_provider, external_subject, display_name)
       VALUES ('test', $1, 'Catalogue test actor') RETURNING id`,
      [`catalogue-${suffix}`],
    )
  ).rows[0].id;
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("DELETE FROM audit.event WHERE company_id = $1", [
      companyId,
    ]);
    await client.query(
      "DELETE FROM platform.command_idempotency WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM catalog.product_branch WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM catalog.product_barcode WHERE company_id = $1",
      [companyId],
    );
    await client.query(
      "DELETE FROM catalog.price_list_item WHERE company_id = $1",
      [companyId],
    );
    await client.query("DELETE FROM catalog.price_list WHERE company_id = $1", [
      companyId,
    ]);
    await client.query("DELETE FROM catalog.product WHERE company_id = $1", [
      companyId,
    ]);
    await client.query("DELETE FROM catalog.tax_code WHERE company_id = $1", [
      companyId,
    ]);
    await client.query("DELETE FROM platform.branch WHERE company_id = $1", [
      companyId,
    ]);
    await client.query("DELETE FROM platform.app_user WHERE id = $1", [
      actorUserId,
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

describe("CatalogManagementService", () => {
  it("returns only active products explicitly enabled for the POS branch", async () => {
    const context = { companyId, actorUserId };
    const sellable = await catalogue.createProduct(
      context,
      {
        name: "POS catalogue product",
        productKind: "stock",
        unitPrice: "9.50",
        priceListName: "Default retail",
      },
      `pos-catalogue-sellable-${suffix}`,
    );
    const unavailable = await catalogue.createProduct(
      context,
      {
        name: "Back-office only product",
        productKind: "stock",
        unitPrice: "7.00",
        priceListName: "Default retail",
      },
      `pos-catalogue-unavailable-${suffix}`,
    );
    await catalogue.setBranchAvailability(
      context,
      branchId,
      sellable.data.id,
      { isSellable: true },
      `pos-catalogue-availability-${suffix}`,
    );

    const result = await catalogue.listPosCatalogue({ ...context, branchId });

    expect(result.refreshedAt).toBeTruthy();
    expect(result.products).toEqual([
      expect.objectContaining({
        id: sellable.data.id,
        name: "POS catalogue product",
        unitPrice: "9.500000",
      }),
    ]);
    expect(result.products.map((product) => product.id)).not.toContain(
      unavailable.data.id,
    );
  });

  it("keeps effective price history while maintaining the product and branch controls", async () => {
    const context = { companyId, actorUserId };
    const created = await catalogue.createProduct(
      context,
      {
        name: "Service test product",
        productKind: "stock",
        unitPrice: "12.00",
        priceListName: "Default retail",
      },
      `product-create-${suffix}`,
    );
    await catalogue.createBarcode(
      context,
      created.data.id,
      { barcode: `629${suffix.replaceAll("-", "").slice(0, 10)}` },
      `barcode-create-${suffix}`,
    );
    await catalogue.setBranchAvailability(
      context,
      branchId,
      created.data.id,
      { isSellable: false, reorderPoint: "4" },
      `availability-set-${suffix}`,
    );

    const update = {
      expectedUpdatedAt: created.data.updatedAt,
      isActive: false,
      unitPrice: "15.00",
    };
    const updated = await catalogue.updateProduct(
      context,
      created.data.id,
      update,
      `product-update-${suffix}`,
    );
    const retried = await catalogue.updateProduct(
      context,
      created.data.id,
      update,
      `product-update-${suffix}`,
    );

    expect(updated).toEqual(retried);
    expect(updated.data).toMatchObject({
      id: created.data.id,
      isActive: false,
      unitPrice: "15.000000",
      barcodes: [`629${suffix.replaceAll("-", "").slice(0, 10)}`],
    });

    const [prices, branch, audit] = await Promise.all([
      pool.query<{ unit_price: string; effective_until: Date | null }>(
        `SELECT unit_price::text, effective_until
         FROM catalog.price_list_item
         WHERE company_id = $1 AND product_id = $2 ORDER BY effective_from`,
        [companyId, created.data.id],
      ),
      pool.query<{ is_sellable: boolean; reorder_point: string | null }>(
        `SELECT is_sellable, reorder_point::text
         FROM catalog.product_branch WHERE product_id = $1 AND branch_id = $2`,
        [created.data.id, branchId],
      ),
      pool.query<{ action: string; correlation_id: string | null }>(
        `SELECT action, correlation_id::text
         FROM audit.event
         WHERE company_id = $1
           AND (entity_id = $2::uuid OR metadata ->> 'productId' = $2::text)
         ORDER BY occurred_at`,
        [companyId, created.data.id],
      ),
    ]);

    expect(prices.rows).toHaveLength(2);
    expect(prices.rows[0]).toMatchObject({
      unit_price: "12.000000",
    });
    expect(prices.rows[0].effective_until).not.toBeNull();
    expect(prices.rows[1]).toEqual({
      unit_price: "15.000000",
      effective_until: null,
    });
    expect(branch.rows).toEqual([
      { is_sellable: false, reorder_point: "4.000000" },
    ]);
    expect(audit.rows.map((event) => event.action)).toEqual([
      "catalog.product.created",
      "catalog.product_barcode.created",
      "catalog.product_branch.updated",
      "catalog.product.deactivated",
    ]);
    expect(audit.rows.every((event) => event.correlation_id !== null)).toBe(
      true,
    );
  });
});
