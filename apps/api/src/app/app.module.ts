import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { CatalogController } from "../catalog/catalog.controller.js";
import {
  AUTHORIZATION_POOL,
  AuthorizationService,
  createAuthorizationPool,
} from "../auth/authorization.service.js";
import { SessionService } from "../auth/session.service.js";
import {
  OIDC_PROVIDER,
  OIDC_SETTINGS,
  OIDC_TRANSACTION_CIPHER,
  OpenIdConnectProvider,
  loadOidcSettings,
  type OidcSettings,
} from "../auth/oidc-provider.js";
import { OidcLoginService } from "../auth/oidc-login.service.js";
import { OidcTransactionCipher } from "../auth/oidc-transaction-cipher.js";
import { AuthController } from "../auth/auth.controller.js";

@Module({
  controllers:
    process.env.LEDGERLITE_ENABLE_DEVELOPMENT_CATALOG === "true"
      ? [AppController, AuthController, CatalogController]
      : [AppController, AuthController],
  providers: [
    {
      provide: AUTHORIZATION_POOL,
      useFactory: createAuthorizationPool,
    },
    {
      provide: OIDC_SETTINGS,
      useFactory: loadOidcSettings,
    },
    {
      provide: OIDC_PROVIDER,
      inject: [OIDC_SETTINGS],
      useFactory: (settings: OidcSettings | undefined) =>
        new OpenIdConnectProvider(settings),
    },
    {
      provide: OIDC_TRANSACTION_CIPHER,
      inject: [OIDC_SETTINGS],
      useFactory: (settings: OidcSettings | undefined) =>
        settings
          ? new OidcTransactionCipher(settings.transactionEncryptionKey)
          : undefined,
    },
    AuthorizationService,
    SessionService,
    OidcLoginService,
  ],
})
export class AppModule {}
