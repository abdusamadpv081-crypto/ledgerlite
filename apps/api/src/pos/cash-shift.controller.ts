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
  CashShiftService,
  type OpenCashShiftInput,
} from "./cash-shift.service.js";

const id = z.string().uuid();
const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);
const openShift = z
  .object({
    deviceId: id,
    openingFloat: z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
function key(value: unknown): string {
  if (Array.isArray(value))
    throw new BadRequestException(
      "Only one Idempotency-Key header is allowed.",
    );
  return parse(idempotencyKey, value);
}

@Controller("companies/:companyId/branches/:branchId/pos/shifts")
@UseGuards(SessionAuthenticationGuard, ScopedCapabilityGuard)
@RequireCapability("pos.shift.operate")
export class CashShiftController {
  constructor(private readonly shifts: CashShiftService) {}

  @Get("current")
  current(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.shifts.current(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, branchId),
    );
  }

  @Post()
  open(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.shifts.open(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, branchId),
      parse(openShift, body) as OpenCashShiftInput,
      key(header),
    );
  }
}
