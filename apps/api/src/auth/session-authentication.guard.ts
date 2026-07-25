import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { SessionService } from "./session.service.js";
import type { AuthenticatedRequest } from "./authorization.decorators.js";
import { SESSION_COOKIE_NAME } from "./session-cookie.js";

@Injectable()
export class SessionAuthenticationGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionToken) {
      throw new UnauthorizedException("A valid browser session is required.");
    }

    request.actor = await this.sessions.authenticate(sessionToken);
    return true;
  }
}
