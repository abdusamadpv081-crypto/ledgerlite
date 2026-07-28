import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Param,
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
import { SaleSyncService, type SaleSyncInput } from "./sale-sync.service.js";

const id = z.string().uuid();
const decimal = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/);
const taxCode = z
  .object({
    id,
    code: z.string().trim().min(1).max(32),
    name: z.string().trim().min(1).max(120),
    rate: decimal,
  })
  .strict();
const line = z
  .object({
    productId: id,
    productName: z.string().trim().min(1).max(240),
    sku: z.string().trim().min(1).max(80).nullable(),
    quantity: z.number().int().min(1).max(999_999),
    unitPrice: decimal,
    taxTreatment: z.enum(["inclusive", "exclusive"]),
    taxCode: taxCode.nullable(),
    netAmount: decimal,
    taxAmount: decimal,
    totalAmount: decimal,
  })
  .strict();
const sale = z
  .object({
    schemaVersion: z.literal(1),
    eventType: z.literal("cash_sale"),
    eventId: id,
    localReceiptId: id,
    localSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    companyId: id,
    branchId: id,
    deviceId: id,
    cashierUserId: id,
    shiftId: id,
    authorityGrantId: id,
    authorityPolicyId: id,
    authorityPolicyVersion: z.number().int().positive(),
    occurredAt: z.string().datetime({ offset: true }),
    currency: z.string().regex(/^[A-Z]{3}$/),
    payment: z.object({ method: z.literal("cash"), amount: decimal }).strict(),
    lines: z.array(line).min(1).max(500),
    totals: z
      .object({ netAmount: decimal, taxAmount: decimal, totalAmount: decimal })
      .strict(),
    deviceSignature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}

@Controller("companies/:companyId/branches/:branchId/pos/sales")
@UseGuards(SessionAuthenticationGuard, ScopedCapabilityGuard)
@RequireCapability("pos.sale.create")
export class SaleSyncController {
  constructor(
    @Inject(SaleSyncService) private readonly sales: SaleSyncService,
  ) {}

  @Post("sync")
  sync(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.sales.sync(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, branchId),
      parse(sale, body) as SaleSyncInput,
    );
  }
}
