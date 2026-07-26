import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import {
  CurrentActor,
  RequireCapability,
} from "../auth/authorization.decorators.js";
import { ScopedCapabilityGuard } from "../auth/scoped-capability.guard.js";
import { SessionAuthenticationGuard } from "../auth/session-authentication.guard.js";
import type { AuthenticatedActor } from "../auth/session.service.js";
import {
  CatalogManagementService,
  type CreateProduct,
  type CreateBarcode,
  type BranchAvailability,
  type CreateTaxCode,
  type UpdateProduct,
} from "./catalog-management.service.js";

const id = z.string().uuid();
const key = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const decimal = z.string().regex(/^\d+(?:\.\d{1,6})?$/);
const timestamp = z.string().datetime({ offset: true });
const tax = z
  .object({
    code: text(32).transform((value) => value.toUpperCase()),
    name: text(120),
    rate: decimal.refine((value) => Number(value) >= 0 && Number(value) <= 1),
  })
  .strict();
const product = z
  .object({
    sku: z
      .union([text(80), z.literal("")])
      .optional()
      .transform((value) => value || undefined),
    name: text(240),
    productKind: z.enum(["stock", "service"]).optional().default("stock"),
    defaultTaxCodeId: id.optional(),
    unitPrice: decimal,
    priceListName: text(120).optional().default("Default retail"),
  })
  .strict();
const productUpdate = z
  .object({
    expectedUpdatedAt: timestamp,
    sku: z
      .union([text(80), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" ? null : value)),
    name: text(240).optional(),
    productKind: z.enum(["stock", "service"]).optional(),
    defaultTaxCodeId: z.union([id, z.null()]).optional(),
    isActive: z.boolean().optional(),
    unitPrice: decimal.optional(),
    priceListName: text(120).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      [
        value.sku,
        value.name,
        value.productKind,
        value.defaultTaxCodeId,
        value.isActive,
        value.unitPrice,
      ].every((field) => field === undefined)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one product field must be changed.",
      });
    if (value.priceListName !== undefined && value.unitPrice === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "priceListName can only be sent with unitPrice.",
      });
  });
const barcode = z
  .object({ barcode: text(128), symbology: text(32).optional() })
  .strict();
const availability = z
  .object({
    isSellable: z.boolean(),
    reorderPoint: z.union([decimal, z.null()]).optional(),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
function idempotency(value: unknown): string {
  if (Array.isArray(value))
    throw new BadRequestException(
      "Only one Idempotency-Key header is allowed.",
    );
  return parse(key, value);
}

@Controller("companies/:companyId/catalog")
@UseGuards(SessionAuthenticationGuard, ScopedCapabilityGuard)
@RequireCapability("catalog.manage")
export class CatalogManagementController {
  constructor(
    @Inject(CatalogManagementService)
    private readonly catalogue: CatalogManagementService,
  ) {}
  @Get()
  list(
    @Param("companyId") companyId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.catalogue.list({
      companyId: parse(id, companyId),
      actorUserId: actor.userId,
    });
  }
  @Post("tax-codes")
  createTax(
    @Param("companyId") companyId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.catalogue.createTaxCode(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(tax, body) as CreateTaxCode,
      idempotency(header),
    );
  }
  @Post("products")
  createProduct(
    @Param("companyId") companyId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.catalogue.createProduct(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(product, body) as CreateProduct,
      idempotency(header),
    );
  }
  @Patch("products/:productId")
  updateProduct(
    @Param("companyId") companyId: string,
    @Param("productId") productId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.catalogue.updateProduct(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, productId),
      parse(productUpdate, body) as UpdateProduct,
      idempotency(header),
    );
  }
  @Post("products/:productId/barcodes")
  createBarcode(
    @Param("companyId") companyId: string,
    @Param("productId") productId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.catalogue.createBarcode(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, productId),
      parse(barcode, body) as CreateBarcode,
      idempotency(header),
    );
  }
  @Post("branches/:branchId/products/:productId/availability")
  setBranchAvailability(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @Param("productId") productId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.catalogue.setBranchAvailability(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, branchId),
      parse(id, productId),
      parse(availability, body) as BranchAvailability,
      idempotency(header),
    );
  }
}
