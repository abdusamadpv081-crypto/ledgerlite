import {
  Controller,
  Get,
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

@Controller("auth")
export class AuthController {
  constructor(
    private readonly oidcLogin: OidcLoginService,
    private readonly sessions: SessionService,
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

  @Get("login")
  async login(
    @Query("returnTo") returnTo: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const started = await this.oidcLogin.start(returnTo);
    await reply.redirect(started.authorizationUrl.toString());
  }

  @Get("callback")
  async callback(
    @Query("state") state: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const completed = await this.oidcLogin.complete(request.url, state);
    reply.setCookie(SESSION_COOKIE_NAME, completed.session.token, {
      ...sessionCookieOptions,
      expires: completed.session.expiresAt,
    });
    await reply.redirect(completed.returnTo);
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
