import "reflect-metadata";

import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import {
  RequireCapability,
  type AuthenticatedRequest,
} from "../src/auth/authorization.decorators.js";
import type { AuthorizationService } from "../src/auth/authorization.service.js";
import { ScopedCapabilityGuard } from "../src/auth/scoped-capability.guard.js";
import { SessionAuthenticationGuard } from "../src/auth/session-authentication.guard.js";
import { SESSION_COOKIE_NAME } from "../src/auth/session-cookie.js";
import type { SessionService } from "../src/auth/session.service.js";

class CapabilityRoute {
  @RequireCapability("catalog.manage")
  manageCatalog() {}
}

function executionContext(
  request: AuthenticatedRequest,
  handler = CapabilityRoute.prototype.manageCatalog,
): ExecutionContext {
  return {
    getClass: () => CapabilityRoute,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("SessionAuthenticationGuard", () => {
  it("attaches the actor resolved from the secure session cookie", async () => {
    const request = {
      cookies: { [SESSION_COOKIE_NAME]: "session-token" },
    } as AuthenticatedRequest;
    const guard = new SessionAuthenticationGuard({
      authenticate: async (token: string) => {
        expect(token).toBe("session-token");
        return { userId: "user-id" };
      },
    } as SessionService);

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(
      true,
    );
    expect(request.actor).toEqual({ userId: "user-id" });
  });

  it("rejects a request without the session cookie", async () => {
    const guard = new SessionAuthenticationGuard({} as SessionService);

    await expect(
      guard.canActivate(
        executionContext({ cookies: {} } as AuthenticatedRequest),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe("ScopedCapabilityGuard", () => {
  it("uses only route company and branch scope after session authentication", async () => {
    const checks: unknown[] = [];
    const guard = new ScopedCapabilityGuard(new Reflector(), {
      assertCapability: async (context: unknown, capability: string) => {
        checks.push({ capability, context });
      },
    } as AuthorizationService);
    const request = {
      actor: { userId: "actor-id" },
      params: {
        branchId: "2dcadc1c-2e93-4baa-bd04-a986264d254f",
        companyId: "11cb8044-5eae-49af-9e86-a2c69c4d4b95",
      },
    } as AuthenticatedRequest;

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(
      true,
    );
    expect(checks).toEqual([
      {
        capability: "catalog.manage",
        context: {
          actorUserId: "actor-id",
          branchId: "2dcadc1c-2e93-4baa-bd04-a986264d254f",
          companyId: "11cb8044-5eae-49af-9e86-a2c69c4d4b95",
        },
      },
    ]);
  });

  it("rejects unauthenticated or malformed tenant context before authorization", async () => {
    const guard = new ScopedCapabilityGuard(
      new Reflector(),
      {} as AuthorizationService,
    );

    await expect(
      guard.canActivate(
        executionContext({
          params: { companyId: "11cb8044-5eae-49af-9e86-a2c69c4d4b95" },
        } as AuthenticatedRequest),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      guard.canActivate(
        executionContext({
          actor: { userId: "actor-id" },
          params: { companyId: "not-a-uuid" },
        } as AuthenticatedRequest),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
