import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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
import {
  PeriodManagementService,
  type CloseFiscalPeriodInput,
  type CreateFiscalPeriodInput,
} from "./period-management.service.js";

const id = z.string().uuid();
const key = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const localDate = z.string().refine(
  (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  },
  { message: "A valid ISO local date is required." },
);
const create = z
  .object({ name: text(120), startsOn: localDate, endsOn: localDate })
  .strict()
  .refine((value) => value.endsOn > value.startsOn, {
    message: "endsOn must be after startsOn.",
  });
const close = z
  .object({ expectedUpdatedAt: z.string().datetime({ offset: true }) })
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

@Controller("companies/:companyId/accounting/periods")
@UseGuards(SessionAuthenticationGuard, ScopedCapabilityGuard)
export class PeriodManagementController {
  constructor(
    @Inject(PeriodManagementService)
    private readonly periods: PeriodManagementService,
  ) {}

  @Get()
  @RequireCapability("accounting.journal.read")
  list(
    @Param("companyId") companyId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.periods.list({
      companyId: parse(id, companyId),
      actorUserId: actor.userId,
    });
  }

  @Post()
  @RequireCapability("accounting.period.manage")
  create(
    @Param("companyId") companyId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.periods.create(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(create, body) as CreateFiscalPeriodInput,
      idempotency(header),
    );
  }

  @Post(":periodId/close")
  @RequireCapability("accounting.period.manage")
  close(
    @Param("companyId") companyId: string,
    @Param("periodId") periodId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.periods.close(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, periodId),
      parse(close, body) as CloseFiscalPeriodInput,
      idempotency(header),
    );
  }
}
