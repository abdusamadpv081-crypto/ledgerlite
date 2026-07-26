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
  DeviceManagementService,
  type RegisterDeviceInput,
  type UpdateDeviceStatusInput,
} from "./device-management.service.js";

const id = z.string().uuid();
const key = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const base64Url = z.string().regex(/^[A-Za-z0-9_-]{40,128}$/);
const publicKeyJwk = z
  .object({
    alg: z.literal("ES256").optional(),
    crv: z.literal("P-256"),
    ext: z.boolean().optional(),
    key_ops: z.array(z.literal("verify")).max(1).optional(),
    kty: z.literal("EC"),
    x: base64Url,
    y: base64Url,
  })
  .strict();
const register = z
  .object({
    displayName: text(120),
    publicKeyJwk: publicKeyJwk,
    appVersion: text(64).optional(),
    localSchemaVersion: z.number().int().min(1).max(10000).optional(),
  })
  .strict();
const updateStatus = z
  .object({
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    status: z.enum(["registered", "suspended", "retired"]),
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

@Controller("companies/:companyId/branches/:branchId/devices")
@UseGuards(SessionAuthenticationGuard, ScopedCapabilityGuard)
@RequireCapability("pos.device.manage")
export class DeviceManagementController {
  constructor(
    @Inject(DeviceManagementService)
    private readonly devices: DeviceManagementService,
  ) {}

  @Get()
  list(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.devices.list(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, branchId),
    );
  }

  @Post()
  register(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.devices.register(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, branchId),
      parse(register, body) as RegisterDeviceInput,
      idempotency(header),
    );
  }

  @Patch(":deviceId")
  updateStatus(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @Param("deviceId") deviceId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.devices.updateStatus(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, branchId),
      parse(id, deviceId),
      parse(updateStatus, body) as UpdateDeviceStatusInput,
      idempotency(header),
    );
  }
}
