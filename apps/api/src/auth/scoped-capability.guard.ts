import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { z } from "zod";
import { AuthorizationService } from "./authorization.service.js";
import {
  REQUIRED_CAPABILITY_METADATA,
  type AuthenticatedRequest,
} from "./authorization.decorators.js";
import type { Capability } from "@ledgerlite/domain";

const identifierSchema = z.string().uuid();

function routeIdentifier(
  params: Record<string, unknown>,
  key: "branchId" | "companyId",
  required: boolean,
): string | undefined {
  const parsed = identifierSchema.safeParse(params[key]);
  if (parsed.success) {
    return parsed.data;
  }
  if (!required && params[key] === undefined) {
    return undefined;
  }
  throw new BadRequestException(`${key} route parameter must be a UUID.`);
}

@Injectable()
export class ScopedCapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.getAllAndOverride<Capability | undefined>(
      REQUIRED_CAPABILITY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!capability) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.actor) {
      throw new UnauthorizedException("A valid browser session is required.");
    }

    const params = (request.params ?? {}) as Record<string, unknown>;
    await this.authorization.assertCapability(
      {
        actorUserId: request.actor.userId,
        branchId: routeIdentifier(params, "branchId", false),
        companyId: routeIdentifier(params, "companyId", true) as string,
      },
      capability,
    );
    return true;
  }
}
