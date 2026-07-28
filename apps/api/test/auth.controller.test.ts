import { describe, expect, it } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthController } from "../src/auth/auth.controller.js";
import { SESSION_COOKIE_NAME } from "../src/auth/session-cookie.js";
import type { OidcLoginService } from "../src/auth/oidc-login.service.js";
import type { SessionService } from "../src/auth/session.service.js";
import type { CompanyContextService } from "../src/auth/company-context.service.js";

class ReplyStub {
  statusCode: number | undefined;
  redirectUrl: string | undefined;
  setCookieCall:
    | { name: string; options: Record<string, unknown>; value: string }
    | undefined;
  clearCookieCall:
    { name: string; options: Record<string, unknown> } | undefined;

  setCookie(name: string, value: string, options: Record<string, unknown>) {
    this.setCookieCall = { name, options, value };
    return this;
  }

  clearCookie(name: string, options: Record<string, unknown>) {
    this.clearCookieCall = { name, options };
    return this;
  }

  code(statusCode: number) {
    this.statusCode = statusCode;
    return this;
  }

  redirect(url: string) {
    this.redirectUrl = url;
    return this;
  }

  send() {
    return this;
  }
}

describe("AuthController", () => {
  it("redirects a login request to the OIDC provider", async () => {
    let requestedReturnTo: string | undefined;
    const controller = new AuthController(
      {
        start: async (returnTo: string | undefined) => {
          requestedReturnTo = returnTo;
          return {
            authorizationUrl: new URL("https://identity.example/authorize"),
          };
        },
      } as OidcLoginService,
      {} as SessionService,
      {} as CompanyContextService,
    );
    const reply = new ReplyStub();

    await controller.login("/pos", reply as unknown as FastifyReply);

    expect(requestedReturnTo).toBe("/pos");
    expect(reply.redirectUrl).toBe("https://identity.example/authorize");
  });

  it("sets only a secure host cookie after the OIDC callback", async () => {
    const expiresAt = new Date("2026-07-26T12:00:00.000Z");
    let callbackRequestUrl: string | undefined;
    let callbackState: string | undefined;
    const controller = new AuthController(
      {
        complete: async (requestUrl: string, state: string | undefined) => {
          callbackRequestUrl = requestUrl;
          callbackState = state;
          return {
            returnTo: "/pos",
            session: {
              actor: { userId: "user-id" },
              expiresAt,
              token: "opaque-session-token",
            },
          };
        },
      } as OidcLoginService,
      {} as SessionService,
      {} as CompanyContextService,
    );
    const reply = new ReplyStub();

    await controller.callback(
      "callback-state",
      {
        url: "/api/v1/auth/callback?code=code&state=callback-state",
      } as FastifyRequest,
      reply as unknown as FastifyReply,
    );

    expect(callbackRequestUrl).toBe(
      "/api/v1/auth/callback?code=code&state=callback-state",
    );
    expect(callbackState).toBe("callback-state");
    expect(reply.setCookieCall).toEqual({
      name: SESSION_COOKIE_NAME,
      options: {
        expires: expiresAt,
        httpOnly: true,
        path: "/",
        sameSite: "strict",
        secure: true,
      },
      value: "opaque-session-token",
    });
    expect(reply.redirectUrl).toBe("http://localhost:3000/pos");
  });

  it("invalidates the presented session and clears the host cookie on logout", async () => {
    const invalidated: string[] = [];
    const controller = new AuthController(
      {} as OidcLoginService,
      {
        invalidate: async (token: string) => {
          invalidated.push(token);
        },
      } as SessionService,
      {} as CompanyContextService,
    );
    const reply = new ReplyStub();

    await controller.logout(
      {
        cookies: { [SESSION_COOKIE_NAME]: "opaque-session-token" },
      } as FastifyRequest,
      reply as unknown as FastifyReply,
    );

    expect(invalidated).toEqual(["opaque-session-token"]);
    expect(reply.clearCookieCall).toEqual({
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        path: "/",
        sameSite: "strict",
        secure: true,
      },
    });
    expect(reply.statusCode).toBe(204);
  });

  it("lists only server-authorized active company contexts", async () => {
    const controller = new AuthController(
      {} as OidcLoginService,
      {} as SessionService,
      {
        listForActor: async (userId: string) => {
          expect(userId).toBe("user-id");
          return [
            {
              companyId: "company-id",
              legalName: "Ledger Lite Retail",
              tradeName: null,
              status: "active" as const,
              roles: ["owner"],
            },
          ];
        },
      } as CompanyContextService,
    );

    await expect(controller.companies({ userId: "user-id" })).resolves.toEqual([
      {
        companyId: "company-id",
        legalName: "Ledger Lite Retail",
        tradeName: null,
        status: "active",
        roles: ["owner"],
      },
    ]);
  });

  it("lists only branches explicitly assigned to the active actor", async () => {
    const controller = new AuthController(
      {} as OidcLoginService,
      {} as SessionService,
      {
        listBranchesForActor: async (userId: string) => {
          expect(userId).toBe("user-id");
          return [
            {
              companyId: "company-id",
              branchId: "branch-id",
              code: "MAIN",
              name: "Main branch",
            },
          ];
        },
      } as CompanyContextService,
    );

    await expect(controller.branches({ userId: "user-id" })).resolves.toEqual([
      {
        companyId: "company-id",
        branchId: "branch-id",
        code: "MAIN",
        name: "Main branch",
      },
    ]);
  });
});
