import {
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { OidcLoginService } from "./oidc-login.service.js";
import { SessionService } from "./session.service.js";
import { CurrentActor } from "./authorization.decorators.js";
import { SessionAuthenticationGuard } from "./session-authentication.guard.js";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "./session-cookie.js";
import type { AuthenticatedActor } from "./session.service.js";
import { CompanyContextService } from "./company-context.service.js";

function webApplicationReturnUrl(returnTo: string): string {
  const configuredOrigin = process.env.WEB_APP_ORIGIN;
  const isLocalEnvironment =
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  const originValue =
    configuredOrigin ??
    (isLocalEnvironment ? "http://localhost:3000" : undefined);
  if (!originValue)
    throw new Error(
      "WEB_APP_ORIGIN must be configured outside development and test environments.",
    );
  let origin: URL;
  try {
    origin = new URL(originValue);
  } catch {
    throw new Error("WEB_APP_ORIGIN must be an absolute URL.");
  }
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (!isLocalEnvironment && origin.protocol !== "https:")
  )
    throw new Error(
      "WEB_APP_ORIGIN must be an HTTPS origin without credentials or a path outside development and test environments.",
    );
  return new URL(returnTo, origin).toString();
}

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(OidcLoginService) private readonly oidcLogin: OidcLoginService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(CompanyContextService)
    private readonly companyContexts: CompanyContextService,
  ) {}

  @Get("me")
  @UseGuards(SessionAuthenticationGuard)
  me(@CurrentActor() actor: AuthenticatedActor) {
    return { userId: actor.userId };
  }

  @Get("companies")
  @UseGuards(SessionAuthenticationGuard)
  companies(@CurrentActor() actor: AuthenticatedActor) {
    return this.companyContexts.listForActor(actor.userId);
  }

  @Get("branches")
  @UseGuards(SessionAuthenticationGuard)
  branches(@CurrentActor() actor: AuthenticatedActor) {
    return this.companyContexts.listBranchesForActor(actor.userId);
  }

  @Get("login")
  async login(
    @Query("returnTo") returnTo: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const started = await this.oidcLogin.start(returnTo);
    return reply.redirect(started.authorizationUrl.toString());
  }

  @Get("callback")
  async callback(
    @Query("state") state: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const completed = await this.oidcLogin.complete(request.url, state);
    reply.setCookie(SESSION_COOKIE_NAME, completed.session.token, {
      ...sessionCookieOptions,
      expires: completed.session.expiresAt,
    });
    return reply.redirect(webApplicationReturnUrl(completed.returnTo));
  }

  @Post("logout")
  async logout(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    if (sessionToken) {
      await this.sessions.invalidate(sessionToken, "logout");
    }
    reply.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions);
    await reply.code(204).send();
  }
}
