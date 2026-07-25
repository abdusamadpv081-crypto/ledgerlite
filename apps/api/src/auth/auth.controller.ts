import { Controller, Get, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { OidcLoginService } from "./oidc-login.service.js";
import { SessionService } from "./session.service.js";

export const SESSION_COOKIE_NAME = "__Host-ll_session";

const sessionCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "strict" as const,
  secure: true,
};

@Controller("auth")
export class AuthController {
  constructor(
    private readonly oidcLogin: OidcLoginService,
    private readonly sessions: SessionService,
  ) {}

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
