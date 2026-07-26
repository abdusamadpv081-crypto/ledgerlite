import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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
  CompanyBranchService,
  type CreateBranchInput,
  type UpdateBranchInput,
  type UpdateCompanyInput,
} from "./company-branch.service.js";

const identifierSchema = z.string().uuid();
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);
const timestampSchema = z.string().datetime({ offset: true });
const nonEmptyText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\u0000-\u001f]/.test(value), {
      message: "Control characters are not permitted.",
    });
const timeZoneSchema = nonEmptyText(64).refine(
  (value) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { message: "A valid IANA time zone is required." },
);
const currencySchema = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{3}$/.test(value));
const nullableText = (max: number) => z.union([nonEmptyText(max), z.null()]);
const addressSchema = z.record(z.unknown());
const branchCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z0-9][A-Z0-9_-]*$/.test(value));
const companyUpdateSchema = z
  .object({
    expectedUpdatedAt: timestampSchema,
    legalName: nonEmptyText(240).optional(),
    tradeName: nullableText(240).optional(),
    trn: z.union([z.string().regex(/^\d{15}$/), z.null()]).optional(),
    baseCurrency: currencySchema.optional(),
    timeZone: timeZoneSchema.optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      [
        value.legalName,
        value.tradeName,
        value.trn,
        value.baseCurrency,
        value.timeZone,
        value.fiscalYearStartMonth,
      ].every((field) => field === undefined)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one company field must be changed.",
      });
  });
const branchCreateSchema = z
  .object({
    code: branchCodeSchema,
    name: nonEmptyText(240),
    address: addressSchema.optional().default({}),
    timeZone: timeZoneSchema.optional().default("Asia/Dubai"),
    status: z.enum(["active", "inactive"]).optional().default("active"),
  })
  .strict();
const branchUpdateSchema = z
  .object({
    expectedUpdatedAt: timestampSchema,
    code: branchCodeSchema.optional(),
    name: nonEmptyText(240).optional(),
    address: addressSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      [
        value.code,
        value.name,
        value.address,
        value.timeZone,
        value.status,
      ].every((field) => field === undefined)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one branch field must be changed.",
      });
  });
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
function parseIdempotencyKey(value: unknown): string {
  if (Array.isArray(value))
    throw new BadRequestException(
      "Only one Idempotency-Key header is allowed.",
    );
  return parse(idempotencyKeySchema, value);
}

@Controller("companies")
@UseGuards(SessionAuthenticationGuard, ScopedCapabilityGuard)
export class CompanyController {
  constructor(private readonly companies: CompanyBranchService) {}
  @Get(":companyId")
  @RequireCapability("company.read")
  getCompany(
    @Param("companyId") companyId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.companies.getCompany({
      actorUserId: actor.userId,
      companyId: parse(identifierSchema, companyId),
    });
  }
  @Patch(":companyId")
  @RequireCapability("company.manage")
  updateCompany(
    @Param("companyId") companyId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.companies.updateCompany(
      {
        actorUserId: actor.userId,
        companyId: parse(identifierSchema, companyId),
      },
      parse(companyUpdateSchema, body) as UpdateCompanyInput,
      parseIdempotencyKey(idempotencyKey),
    );
  }
  @Get(":companyId/branches")
  @RequireCapability("company.read")
  listBranches(
    @Param("companyId") companyId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.companies.listBranches({
      actorUserId: actor.userId,
      companyId: parse(identifierSchema, companyId),
    });
  }
  @Post(":companyId/branches")
  @RequireCapability("branch.manage")
  createBranch(
    @Param("companyId") companyId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.companies.createBranch(
      {
        actorUserId: actor.userId,
        companyId: parse(identifierSchema, companyId),
      },
      parse(branchCreateSchema, body) as CreateBranchInput,
      parseIdempotencyKey(idempotencyKey),
    );
  }
  @Get(":companyId/branches/:branchId")
  @RequireCapability("branch.read")
  getBranch(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.companies.getBranch(
      {
        actorUserId: actor.userId,
        companyId: parse(identifierSchema, companyId),
      },
      parse(identifierSchema, branchId),
    );
  }
  @Patch(":companyId/branches/:branchId")
  @RequireCapability("branch.manage")
  updateBranch(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.companies.updateBranch(
      {
        actorUserId: actor.userId,
        companyId: parse(identifierSchema, companyId),
      },
      parse(identifierSchema, branchId),
      parse(branchUpdateSchema, body) as UpdateBranchInput,
      parseIdempotencyKey(idempotencyKey),
    );
  }
}
