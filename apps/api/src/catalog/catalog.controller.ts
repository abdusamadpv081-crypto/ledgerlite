import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
} from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const companyIdSchema = z.string().uuid();
const taxSchema = z.object({
  companyId: companyIdSchema,
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  rate: z.number().min(0).max(1),
});
const optionalSkuSchema = z
  .union([z.string().trim().min(1).max(80), z.literal("")])
  .optional()
  .transform((value) => value || undefined);
const productSchema = z.object({
  companyId: companyIdSchema,
  sku: optionalSkuSchema,
  name: z.string().trim().min(1).max(240),
  taxCodeId: z.string().uuid().optional(),
});
const priceSchema = z.object({
  companyId: companyIdSchema,
  productId: z.string().uuid(),
  unitPrice: z.number().finite().min(0),
});
const branchAvailabilitySchema = z.object({
  companyId: companyIdSchema,
  branchId: z.string().uuid(),
  productId: z.string().uuid(),
  isSellable: z.boolean(),
});

@Controller("development/catalog")
export class CatalogController {
  private assertEnabled() {
    if (process.env.LEDGERLITE_ENABLE_DEVELOPMENT_CATALOG !== "true") {
      throw new NotFoundException();
    }
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }

  private async withCompany<T>(
    companyId: string,
    operation: (client: PoolClient) => Promise<T>,
  ) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_company_id', $1, true)",
        [companyId],
      );
      await client.query("SET LOCAL ROLE ledgerlite_app");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @Post("bootstrap")
  async bootstrap() {
    this.assertEnabled();
    const demoCompanyName = "Ledger Lite Development Demo";
    const existing = await pool.query<{ id: string }>(
      "SELECT id FROM platform.company WHERE legal_name = $1 ORDER BY created_at LIMIT 1",
      [demoCompanyName],
    );
    const companyId =
      existing.rows[0]?.id ??
      (
        await pool.query<{ id: string }>(
          "INSERT INTO platform.company (legal_name) VALUES ($1) RETURNING id",
          [demoCompanyName],
        )
      ).rows[0].id;
    const branch = await pool.query<{ id: string }>(
      "SELECT id FROM platform.branch WHERE company_id = $1 LIMIT 1",
      [companyId],
    );
    const branchId =
      branch.rows[0]?.id ??
      (
        await pool.query<{ id: string }>(
          "INSERT INTO platform.branch (company_id, code, name) VALUES ($1, 'MAIN', 'Main branch') RETURNING id",
          [companyId],
        )
      ).rows[0].id;
    return { companyId, branchId };
  }

  @Get()
  async list(@Query("companyId") companyIdValue: string) {
    this.assertEnabled();
    const companyId = this.parse(companyIdSchema, companyIdValue);
    return this.withCompany(companyId, async (client) => {
      const products = await client.query(
        `SELECT product.id, product.sku, product.name, tax.code AS tax_code,
              price.unit_price::text AS unit_price
       FROM catalog.product AS product
       LEFT JOIN catalog.tax_code AS tax ON tax.id = product.default_tax_code_id
       LEFT JOIN LATERAL (
         SELECT item.unit_price
         FROM catalog.price_list_item AS item
         JOIN catalog.price_list AS list ON list.id = item.price_list_id
         WHERE item.product_id = product.id
           AND list.status = 'active'
           AND list.effective_from <= now()
           AND (list.effective_until IS NULL OR list.effective_until > now())
           AND item.effective_from <= now()
           AND (item.effective_until IS NULL OR item.effective_until > now())
         ORDER BY item.effective_from DESC
         LIMIT 1
       ) AS price ON true
       ORDER BY product.name`,
      );
      const taxes = await client.query(
        "SELECT id, code, name, rate FROM catalog.tax_code ORDER BY code",
      );
      return { products: products.rows, taxes: taxes.rows };
    });
  }

  @Post("taxes")
  async createTax(
    @Body()
    body: unknown,
  ) {
    this.assertEnabled();
    const input = this.parse(taxSchema, body);
    return this.withCompany(
      input.companyId,
      async (client) =>
        (
          await client.query(
            "INSERT INTO catalog.tax_code (company_id, code, name, rate) VALUES ($1, $2, $3, $4) RETURNING id, code, name, rate",
            [input.companyId, input.code, input.name, input.rate],
          )
        ).rows[0],
    );
  }

  @Post("products")
  async createProduct(
    @Body()
    body: unknown,
  ) {
    this.assertEnabled();
    const input = this.parse(productSchema, body);
    return this.withCompany(
      input.companyId,
      async (client) =>
        (
          await client.query(
            "INSERT INTO catalog.product (company_id, sku, name, default_tax_code_id) VALUES ($1, $2, $3, $4) RETURNING id, sku, name",
            [
              input.companyId,
              input.sku ?? null,
              input.name,
              input.taxCodeId ?? null,
            ],
          )
        ).rows[0],
    );
  }

  @Post("prices")
  async createPrice(
    @Body()
    body: unknown,
  ) {
    this.assertEnabled();
    const input = this.parse(priceSchema, body);
    return this.withCompany(input.companyId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${input.companyId}:Default retail`,
      ]);
      const priceList = await client.query<{ id: string }>(
        `SELECT id
         FROM catalog.price_list
         WHERE company_id = $1
           AND name = 'Default retail'
           AND status = 'active'
           AND effective_from <= now()
           AND (effective_until IS NULL OR effective_until > now())
         ORDER BY effective_from DESC
         LIMIT 1`,
        [input.companyId],
      );
      const priceListId =
        priceList.rows[0]?.id ??
        (
          await client.query<{ id: string }>(
            "INSERT INTO catalog.price_list (company_id, name) VALUES ($1, 'Default retail') RETURNING id",
            [input.companyId],
          )
        ).rows[0].id;
      return (
        await client.query(
          "INSERT INTO catalog.price_list_item (company_id, price_list_id, product_id, unit_price) VALUES ($1, $2, $3, $4) RETURNING id, unit_price",
          [input.companyId, priceListId, input.productId, input.unitPrice],
        )
      ).rows[0];
    });
  }

  @Post("branch-availability")
  async setBranchAvailability(
    @Body()
    body: unknown,
  ) {
    this.assertEnabled();
    const input = this.parse(branchAvailabilitySchema, body);
    return this.withCompany(
      input.companyId,
      async (client) =>
        (
          await client.query(
            `INSERT INTO catalog.product_branch (company_id, branch_id, product_id, is_sellable)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, branch_id) DO UPDATE SET is_sellable = EXCLUDED.is_sellable
         RETURNING is_sellable`,
            [
              input.companyId,
              input.branchId,
              input.productId,
              input.isSellable,
            ],
          )
        ).rows[0],
    );
  }
}
