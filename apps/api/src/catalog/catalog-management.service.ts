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
              AND list.effective_from <= now() AND (list.effective_until IS NULL OR list.effective_until > now())
              AND item.effective_from <= now() AND (item.effective_until IS NULL OR item.effective_until > now())
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
          "SELECT id FROM catalog.price_list WHERE name = $1 AND status = 'active' AND effective_from <= now() AND (effective_until IS NULL OR effective_until > now()) ORDER BY effective_from DESC LIMIT 1",
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
        const detail = await client.query<Record<string, unknown>>(
          `SELECT ${productSelect} FROM catalog.product AS product LEFT JOIN catalog.tax_code AS tax ON tax.id = product.default_tax_code_id JOIN catalog.price_list_item AS item ON item.product_id = product.id JOIN catalog.price_list AS price ON price.id = item.price_list_id WHERE product.id = $1`,
          [productId],
        );
        const data = product(detail.rows[0]);
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
      const response = await operation(client, record.correlation_id);
      await client.query(
        "SELECT platform.complete_command_idempotency($1, $2, $3)",
        [command, key, response],
      );
      return response;
    });
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
