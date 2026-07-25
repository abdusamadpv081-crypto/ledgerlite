import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { Capability } from "@ledgerlite/domain";
import type { AuthenticatedActor } from "./session.service.js";

export const REQUIRED_CAPABILITY_METADATA = "ledgerlite:required-capability";

export type AuthenticatedRequest = FastifyRequest & {
  actor?: AuthenticatedActor;
};

export const RequireCapability = (capability: Capability) =>
  SetMetadata(REQUIRED_CAPABILITY_METADATA, capability);

export const CurrentActor = createParamDecorator(
  (
    _data: unknown,
    context: ExecutionContext,
  ): AuthenticatedActor | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.actor;
  },
);
