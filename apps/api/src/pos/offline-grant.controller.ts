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
  OfflineGrantService,
  type IssueOfflineGrantInput,
} from "./offline-grant.service.js";

const id = z.string().uuid();
const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);
const challenge = z.object({ deviceId: id }).strict();
const issue = z
  .object({
    challengeId: id,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
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

@Controller("companies/:companyId/branches/:branchId/pos/offline-grants")
@UseGuards(SessionAuthenticationGuard, ScopedCapabilityGuard)
@RequireCapability("pos.shift.operate")
export class OfflineGrantController {
  constructor(private readonly grants: OfflineGrantService) {}

  @Post("challenges")
  challenge(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    const input = parse(challenge, body);
    return this.grants.createChallenge(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, branchId),
      input.deviceId,
      key(header),
    );
  }

  @Post()
  issue(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.grants.issue(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(id, branchId),
      parse(issue, body) as IssueOfflineGrantInput,
      key(header),
    );
  }
}

@Controller("pos/offline-grants")
export class OfflineGrantVerificationKeyController {
  constructor(private readonly grants: OfflineGrantService) {}

  @Get("verification-key")
  verificationKey() {
    return this.grants.verificationKey();
  }
}
