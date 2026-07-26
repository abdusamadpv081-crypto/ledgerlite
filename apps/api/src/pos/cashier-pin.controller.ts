import {
  BadRequestException,
  Body,
  Controller,
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
  CashierPinService,
  type SetCashierPinInput,
} from "./cashier-pin.service.js";

const id = z.string().uuid();
const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);
const setPin = z
  .object({
    deviceId: id,
    pin: z.string().regex(/^\d{8,12}$/),
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

@Controller("companies/:companyId/branches/:branchId/pos/pin")
@UseGuards(SessionAuthenticationGuard, ScopedCapabilityGuard)
@RequireCapability("pos.shift.operate")
export class CashierPinController {
  constructor(private readonly pins: CashierPinService) {}

  @Post()
  set(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.pins.set(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, branchId),
      parse(setPin, body) as SetCashierPinInput,
      key(header),
    );
  }
}
