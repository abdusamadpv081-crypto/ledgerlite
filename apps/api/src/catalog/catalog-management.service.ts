import { createHash, randomUUID } from "node:crypto";

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { AUTHORIZATION_POOL } from "../auth/authorization.service.js";

type Context = Readonly<{ companyId: string; actorUserId: string }>;
type TaxCode = Readonly<{
  id: string;
  code: string;
  name: string;
  rate: string;
}>;
type Product = Readonly<{
  id: string;
  sku: string | null;
  name: string;
  productKind: "stock" | "service";
  isActive: boolean;
  barcodes: readonly string[];
  taxCode: TaxCode | null;
  unitPrice: string;
  currency: string;
  taxTreatment: "inclusive" | "exclusive";
  updatedAt: string;
}>;
type Catalogue = Readonly<{
  taxCodes: readonly TaxCode[];
  products: readonly Product[];
}>;
export type CreateTaxCode = Readonly<{
  code: string;
  name: string;
  rate: string;
}>;
export type CreateProduct = Readonly<{
  sku?: string;
  name: string;
  productKind: "stock" | "service";
  defaultTaxCodeId?: string;
  unitPrice: string;
  priceListName: string;
}>;
export type CreateBarcode = Readonly<{
  barcode: string;
  symbology?: string;
}>;
export type BranchAvailability = Readonly<{
  isSellable: boolean;
  reorderPoint?: string | null;
}>;
export type UpdateProduct = Readonly<{
  expectedUpdatedAt: string;
  sku?: string | null;
  name?: string;
  productKind?: "stock" | "service";
  defaultTaxCodeId?: string | null;
  isActive?: boolean;
  unitPrice?: string;
  priceListName?: string;
}>;
type CommandResponse<T> = Readonly<{ data: T; correlationId: string }>;
type IdempotencyRow = Readonly<{
  is_new: boolean;
  response: CommandResponse<unknown> | null;
  correlation_id: string;
}>;

const productSelect = `product.id, product.sku, product.name, product.product_kind,
  product.is_active, tax.id AS tax_id, tax.code AS tax_code, tax.name AS tax_name,
  tax.rate::text AS tax_rate, price.unit_price::text AS unit_price,
  price.currency, price.tax_treatment,
  COALESCE((SELECT array_agg(barcode.barcode ORDER BY barcode.barcode)
    FROM catalog.product_barcode AS barcode
    WHERE barcode.product_id = product.id AND barcode.is_active), ARRAY[]::text[]) AS barcodes,
  to_char(product.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;

function canonicalJson(value: unknown): string {
  if (value === null || ["boolean", "number", "string"].includes(typeof value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Command payload contains a non-JSON value.");
}
function hash(value: unknown): Buffer {
  return createHash("sha256").update(canonicalJson(value)).digest();
}
function product(row: Record<string, unknown>): Product {
  const taxCode =
    row.tax_id === null
      ? null
      : {
          id: row.tax_id as string,
          code: row.tax_code as string,
          name: row.tax_name as string,
          rate: row.tax_rate as string,
        };
  return {
    id: row.id as string,
    sku: row.sku as string | null,
    name: row.name as string,
    productKind: row.product_kind as Product["productKind"],
    isActive: row.is_active as boolean,
    barcodes: (row.barcodes as string[] | undefined) ?? [],
    taxCode,
    unitPrice: row.unit_price as string,
    currency: row.currency as string,
    taxTreatment: row.tax_treatment as Product["taxTreatment"],
    updatedAt: row.updated_at as string,
  };
}

@Injectable()
export class CatalogManagementService {
  constructor(@Inject(AUTHORIZATION_POOL) private readonly pool: Pool) {}

  async list(context: Context): Promise<Catalogue> {
    return this.withTenant(context, async (client) => {
      const [taxes, products] = await Promise.all([
        client.query<{ id: string; code: string; name: string; rate: string }>(
          "SELECT id, code, name, rate::text FROM catalog.tax_code WHERE is_active ORDER BY code",
        ),
        client.query<Record<string, unknown>>(`SELECT ${productSelect}
          FROM catalog.product AS product
          LEFT JOIN catalog.tax_code AS tax ON tax.id = product.default_tax_code_id
          JOIN LATERAL (
            SELECT item.unit_price, list.currency, list.tax_treatment
            FROM catalog.price_list_item AS item
            JOIN catalog.price_list AS list ON list.id = item.price_list_id
            WHERE item.product_id = product.id AND list.status = 'active'
              AND list.effective_from <= clock_timestamp() AND (list.effective_until IS NULL OR list.effective_until > clock_timestamp())
              AND item.effective_from <= clock_timestamp() AND (item.effective_until IS NULL OR item.effective_until > clock_timestamp())
            ORDER BY item.effective_from DESC LIMIT 1
          ) AS price ON true
          WHERE product.is_active ORDER BY product.name`),
      ]);
      return { taxCodes: taxes.rows, products: products.rows.map(product) };
    });
  }

  async createTaxCode(
    context: Context,
    input: CreateTaxCode,
    key: string,
  ): Promise<CommandResponse<TaxCode>> {
    return this.command(
      context,
      "catalog.tax-code.create",
      key,
      input,
      async (client, correlationId) => {
        const result = await client.query<TaxCode>(
          "INSERT INTO catalog.tax_code (company_id, code, name, rate) VALUES ($1, $2, $3, $4) RETURNING id, code, name, rate::text AS rate",
          [context.companyId, input.code, input.name, input.rate],
        );
        const taxCode = result.rows[0];
        await this.audit(
          client,
          context.companyId,
          "catalog.tax_code.created",
          "catalog.tax_code",
          taxCode.id,
          { code: taxCode.code },
        );
        return { data: taxCode, correlationId };
      },
    );
  }

  async createProduct(
    context: Context,
    input: CreateProduct,
    key: string,
  ): Promise<CommandResponse<Product>> {
    return this.command(
      context,
      "catalog.product.create",
      key,
      input,
      async (client, correlationId) => {
        const created = await client.query<{ id: string }>(
          "INSERT INTO catalog.product (company_id, sku, name, product_kind, default_tax_code_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [
            context.companyId,
            input.sku ?? null,
            input.name,
            input.productKind,
            input.defaultTaxCodeId ?? null,
          ],
        );
        const productId = created.rows[0].id;
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `${context.companyId}:${input.priceListName}`,
        ]);
        const company = await client.query<{ base_currency: string }>(
          "SELECT base_currency FROM platform.company WHERE id = $1",
          [context.companyId],
        );
        if (company.rowCount !== 1)
          throw new NotFoundException("Company was not found.");
        const existing = await client.query<{ id: string }>(
          "SELECT id FROM catalog.price_list WHERE name = $1 AND status = 'active' AND effective_from <= clock_timestamp() AND (effective_until IS NULL OR effective_until > clock_timestamp()) ORDER BY effective_from DESC LIMIT 1",
          [input.priceListName],
        );
        const priceListId =
          existing.rows[0]?.id ??
          (
            await client.query<{ id: string }>(
              "INSERT INTO catalog.price_list (company_id, name, currency) VALUES ($1, $2, $3) RETURNING id",
              [
                context.companyId,
                input.priceListName,
                company.rows[0].base_currency,
              ],
            )
          ).rows[0].id;
        await client.query(
          "INSERT INTO catalog.price_list_item (company_id, price_list_id, product_id, unit_price) VALUES ($1, $2, $3, $4)",
          [context.companyId, priceListId, productId, input.unitPrice],
        );
        const data = await this.productDetail(client, productId);
        await this.audit(
          client,
          context.companyId,
          "catalog.product.created",
          "catalog.product",
          productId,
          {
            priceListName: input.priceListName,
            productKind: input.productKind,
          },
        );
        return { data, correlationId };
      },
    );
  }

  async updateProduct(
    context: Context,
    productId: string,
    input: UpdateProduct,
    key: string,
  ): Promise<CommandResponse<Product>> {
    return this.command(
      context,
      "catalog.product.update",
      key,
      input,
      async (client, correlationId) => {
        const current = await client.query<{ id: string; is_active: boolean }>(
          `SELECT id, is_active FROM catalog.product
           WHERE id = $1 AND updated_at = $2::timestamptz FOR UPDATE`,
          [productId, input.expectedUpdatedAt],
        );
        if (current.rowCount !== 1) {
          const exists = await client.query(
            "SELECT id FROM catalog.product WHERE id = $1",
            [productId],
          );
          if (exists.rowCount !== 1)
            throw new NotFoundException("Product was not found.");
          throw new ConflictException(
            "Product was changed by another user. Refresh and try again.",
          );
        }

        const values: unknown[] = [];
        const assignments: string[] = [];
        const fields: ReadonlyArray<
          readonly [
            keyof Pick<
              UpdateProduct,
              "sku" | "name" | "productKind" | "defaultTaxCodeId" | "isActive"
            >,
            string,
          ]
        > = [
          ["sku", "sku"],
          ["name", "name"],
          ["productKind", "product_kind"],
          ["defaultTaxCodeId", "default_tax_code_id"],
          ["isActive", "is_active"],
        ];
        for (const [property, column] of fields) {
          const value = input[property];
          if (value !== undefined) {
            values.push(value);
            assignments.push(`${column} = $${values.length}`);
          }
        }
        values.push(productId);
        await client.query(
          assignments.length > 0
            ? `UPDATE catalog.product SET ${assignments.join(", ")}
               WHERE id = $${values.length}`
            : "UPDATE catalog.product SET updated_at = updated_at WHERE id = $1",
          assignments.length > 0 ? values : [productId],
        );

        if (input.unitPrice !== undefined)
          await this.replaceRetailPrice(
            client,
            context.companyId,
            productId,
            input.priceListName ?? "Default retail",
            input.unitPrice,
          );

        const action =
          input.isActive === false && current.rows[0].is_active
            ? "catalog.product.deactivated"
            : input.isActive === true && !current.rows[0].is_active
              ? "catalog.product.reactivated"
              : "catalog.product.updated";
        await this.audit(
          client,
          context.companyId,
          action,
          "catalog.product",
          productId,
          {
            changedFields: [
              ...assignments.map((assignment) => assignment.split(" ")[0]),
              ...(input.unitPrice === undefined ? [] : ["unit_price"]),
            ],
          },
        );
        return {
          data: await this.productDetail(client, productId),
          correlationId,
        };
      },
    );
  }

  async createBarcode(
    context: Context,
    productId: string,
    input: CreateBarcode,
    key: string,
  ): Promise<CommandResponse<{ id: string; barcode: string }>> {
    return this.command(
      context,
      "catalog.product-barcode.create",
      key,
      input,
      async (client, correlationId) => {
        const product = await client.query(
          "SELECT id FROM catalog.product WHERE id = $1",
          [productId],
        );
        if (product.rowCount !== 1)
          throw new NotFoundException("Product was not found.");
        const result = await client.query<{ id: string; barcode: string }>(
          "INSERT INTO catalog.product_barcode (company_id, product_id, barcode, symbology) VALUES ($1, $2, $3, $4) RETURNING id, barcode",
          [
            context.companyId,
            productId,
            input.barcode,
            input.symbology ?? null,
          ],
        );
        await this.audit(
          client,
          context.companyId,
          "catalog.product_barcode.created",
          "catalog.product_barcode",
          result.rows[0].id,
          { productId },
        );
        return { data: result.rows[0], correlationId };
      },
    );
  }

  async setBranchAvailability(
    context: Context,
    branchId: string,
    productId: string,
    input: BranchAvailability,
    key: string,
  ): Promise<CommandResponse<BranchAvailability>> {
    return this.command(
      context,
      "catalog.product-branch.set",
      key,
      input,
      async (client, correlationId) => {
        const product = await client.query(
          "SELECT id FROM catalog.product WHERE id = $1",
          [productId],
        );
        const branch = await client.query(
          "SELECT id FROM platform.branch WHERE id = $1",
          [branchId],
        );
        if (product.rowCount !== 1 || branch.rowCount !== 1)
          throw new NotFoundException("Product or branch was not found.");
        const result = await client.query<{
          is_sellable: boolean;
          reorder_point: string | null;
        }>(
          `INSERT INTO catalog.product_branch (company_id, product_id, branch_id, is_sellable, reorder_point)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (product_id, branch_id) DO UPDATE SET is_sellable = EXCLUDED.is_sellable, reorder_point = EXCLUDED.reorder_point
         RETURNING is_sellable, reorder_point::text`,
          [
            context.companyId,
            productId,
            branchId,
            input.isSellable,
            input.reorderPoint ?? null,
          ],
        );
        const data = {
          isSellable: result.rows[0].is_sellable,
          reorderPoint: result.rows[0].reorder_point,
        };
        await this.audit(
          client,
          context.companyId,
          "catalog.product_branch.updated",
          "catalog.product_branch",
          productId,
          { branchId },
        );
        return { data, correlationId };
      },
    );
  }

  private async command<T>(
    context: Context,
    command: string,
    key: string,
    payload: unknown,
    operation: (
      client: PoolClient,
      correlationId: string,
    ) => Promise<CommandResponse<T>>,
  ): Promise<CommandResponse<T>> {
    return this.withTenant(context, async (client) => {
      const acquired = await client.query<IdempotencyRow>(
        "SELECT * FROM platform.acquire_command_idempotency($1, $2, $3, $4)",
        [command, key, hash(payload), randomUUID()],
      );
      const record = acquired.rows[0];
      if (!record.is_new && record.response)
        return record.response as CommandResponse<T>;
      if (!record.is_new)
        throw new ConflictException("The command is still being processed.");
      await client.query(
        "SELECT set_config('app.current_correlation_id', $1, true)",
        [record.correlation_id],
      );
      const response = await operation(client, record.correlation_id);
      await client.query(
        "SELECT platform.complete_command_idempotency($1, $2, $3)",
        [command, key, response],
      );
      return response;
    });
  }
  private async replaceRetailPrice(
    client: PoolClient,
    companyId: string,
    productId: string,
    priceListName: string,
    unitPrice: string,
  ): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${companyId}:${priceListName}`,
    ]);
    const current = await client.query<{
      id: string;
      effective_from: string;
    }>(
      `SELECT item.id, item.effective_from
       FROM catalog.price_list_item AS item
       JOIN catalog.price_list AS list ON list.id = item.price_list_id
       WHERE item.product_id = $1 AND list.name = $2 AND list.status = 'active'
         AND list.effective_from <= clock_timestamp()
         AND (list.effective_until IS NULL OR list.effective_until > clock_timestamp())
         AND item.effective_from <= clock_timestamp()
         AND (item.effective_until IS NULL OR item.effective_until > clock_timestamp())
       ORDER BY item.effective_from DESC LIMIT 1 FOR UPDATE OF item`,
      [productId, priceListName],
    );
    if (current.rowCount !== 1)
      throw new ConflictException("Product has no current retail price.");
    const effective = await client.query<{ value: string }>(
      `SELECT GREATEST(
         clock_timestamp(),
         $1::timestamptz + interval '1 microsecond'
       )::timestamptz::text AS value`,
      [current.rows[0].effective_from],
    );
    await client.query(
      "UPDATE catalog.price_list_item SET effective_until = $1::timestamptz WHERE id = $2",
      [effective.rows[0].value, current.rows[0].id],
    );
    await client.query(
      `INSERT INTO catalog.price_list_item (
        company_id, price_list_id, product_id, unit_price, effective_from
      )
      SELECT item.company_id, item.price_list_id, item.product_id, $1, $2::timestamptz
      FROM catalog.price_list_item AS item WHERE item.id = $3`,
      [unitPrice, effective.rows[0].value, current.rows[0].id],
    );
  }
  private async productDetail(
    client: PoolClient,
    productId: string,
  ): Promise<Product> {
    const detail = await client.query<Record<string, unknown>>(
      `SELECT ${productSelect}
       FROM catalog.product AS product
       LEFT JOIN catalog.tax_code AS tax ON tax.id = product.default_tax_code_id
       JOIN LATERAL (
         SELECT item.unit_price, list.currency, list.tax_treatment
         FROM catalog.price_list_item AS item
         JOIN catalog.price_list AS list ON list.id = item.price_list_id
         WHERE item.product_id = product.id AND list.status = 'active'
           AND list.effective_from <= clock_timestamp()
           AND (list.effective_until IS NULL OR list.effective_until > clock_timestamp())
           AND item.effective_from <= clock_timestamp()
           AND (item.effective_until IS NULL OR item.effective_until > clock_timestamp())
         ORDER BY item.effective_from DESC LIMIT 1
       ) AS price ON true
       WHERE product.id = $1`,
      [productId],
    );
    if (detail.rowCount !== 1)
      throw new NotFoundException("Product was not found.");
    return product(detail.rows[0]);
  }
  private async audit(
    client: PoolClient,
    companyId: string,
    action: string,
    type: string,
    id: string,
    metadata: Record<string, unknown>,
  ) {
    await client.query("SELECT audit.write_event($1, $2, $3, $4, $5)", [
      companyId,
      action,
      type,
      id,
      metadata,
    ]);
  }
  private async withTenant<T>(
    context: Context,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_company_id', $1, true)",
        [context.companyId],
      );
      await client.query(
        "SELECT set_config('app.current_actor_id', $1, true)",
        [context.actorUserId],
      );
      await client.query("SET LOCAL ROLE ledgerlite_app");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "23505"
      )
        throw new ConflictException("A record with that value already exists.");
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { message?: string }).message?.includes("idempotency key")
      )
        throw new ConflictException(
          "Idempotency-Key was already used for a different request.",
        );
      throw error;
    } finally {
      client.release();
    }
  }
}
