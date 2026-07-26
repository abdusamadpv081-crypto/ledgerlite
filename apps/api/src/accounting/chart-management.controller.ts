import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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
  ChartManagementService,
  type CreateAccountInput,
  type CreateStarterChartInput,
} from "./chart-management.service.js";

const id = z.string().uuid();
const key = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const starter = z
  .object({ name: text(240).optional().default("UAE retail starter chart") })
  .strict();
const account = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[0-9a-zA-Z][0-9a-zA-Z._-]{1,31}$/)
      .transform((value) => value.toUpperCase()),
    name: text(240),
    accountType: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
    parentAccountId: id.optional(),
    isPosting: z.boolean().optional().default(true),
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

@Controller("companies/:companyId/accounting")
@UseGuards(SessionAuthenticationGuard, ScopedCapabilityGuard)
export class ChartManagementController {
  constructor(private readonly charts: ChartManagementService) {}

  @Get("chart")
  @RequireCapability("accounting.journal.read")
  activeChart(
    @Param("companyId") companyId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.charts.activeChart({
      companyId: parse(id, companyId),
      actorUserId: actor.userId,
    });
  }

  @Post("chart/starter")
  @RequireCapability("accounting.chart.manage")
  createStarter(
    @Param("companyId") companyId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.charts.createStarter(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(starter, body) as CreateStarterChartInput,
      idempotency(header),
    );
  }

  @Post("chart/accounts")
  @RequireCapability("accounting.chart.manage")
  createAccount(
    @Param("companyId") companyId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.charts.createAccount(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(account, body) as CreateAccountInput,
      idempotency(header),
    );
  }
}
