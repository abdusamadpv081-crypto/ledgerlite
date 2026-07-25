import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { CatalogController } from "../catalog/catalog.controller.js";
import {
  AUTHORIZATION_POOL,
  AuthorizationService,
  createAuthorizationPool,
} from "../auth/authorization.service.js";
import { SessionService } from "../auth/session.service.js";

@Module({
  controllers:
    process.env.LEDGERLITE_ENABLE_DEVELOPMENT_CATALOG === "true"
      ? [AppController, CatalogController]
      : [AppController],
  providers: [
    {
      provide: AUTHORIZATION_POOL,
      useFactory: createAuthorizationPool,
    },
    AuthorizationService,
    SessionService,
  ],
})
export class AppModule {}
