import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { CatalogController } from "../catalog/catalog.controller.js";
import { CatalogManagementController } from "../catalog/catalog-management.controller.js";
import { PosCatalogueController } from "../catalog/pos-catalogue.controller.js";
import { CatalogManagementService } from "../catalog/catalog-management.service.js";
import { CompanyController } from "../company/company.controller.js";
import { CompanyBranchService } from "../company/company-branch.service.js";
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
import { SessionAuthenticationGuard } from "../auth/session-authentication.guard.js";
import { ScopedCapabilityGuard } from "../auth/scoped-capability.guard.js";
import { CompanyContextService } from "../auth/company-context.service.js";
import { DeviceManagementController } from "../device/device-management.controller.js";
import { DeviceManagementService } from "../device/device-management.service.js";
import { ChartManagementController } from "../accounting/chart-management.controller.js";
import { ChartManagementService } from "../accounting/chart-management.service.js";
import { JournalManagementController } from "../accounting/journal-management.controller.js";
import { JournalManagementService } from "../accounting/journal-management.service.js";
import { PeriodManagementController } from "../accounting/period-management.controller.js";
import { PeriodManagementService } from "../accounting/period-management.service.js";
import {
  OfflineGrantController,
  OfflineGrantVerificationKeyController,
} from "../pos/offline-grant.controller.js";
import { OfflineGrantService } from "../pos/offline-grant.service.js";
import { OfflineGrantSigner } from "../pos/offline-grant-signer.js";
import { CashierPinController } from "../pos/cashier-pin.controller.js";
import { CashierPinService } from "../pos/cashier-pin.service.js";
import { CashShiftController } from "../pos/cash-shift.controller.js";
import { CashShiftService } from "../pos/cash-shift.service.js";
import { SaleSyncController } from "../pos/sale-sync.controller.js";
import { SaleSyncService } from "../pos/sale-sync.service.js";

@Module({
  controllers:
    process.env.LEDGERLITE_ENABLE_DEVELOPMENT_CATALOG === "true"
      ? [
          AppController,
          AuthController,
          CompanyController,
          ChartManagementController,
          JournalManagementController,
          PeriodManagementController,
          DeviceManagementController,
          OfflineGrantController,
          OfflineGrantVerificationKeyController,
          CashierPinController,
          CashShiftController,
          SaleSyncController,
          CatalogManagementController,
          PosCatalogueController,
          CatalogController,
        ]
      : [
          AppController,
          AuthController,
          CompanyController,
          ChartManagementController,
          JournalManagementController,
          PeriodManagementController,
          DeviceManagementController,
          OfflineGrantController,
          OfflineGrantVerificationKeyController,
          CashierPinController,
          CashShiftController,
          SaleSyncController,
          CatalogManagementController,
          PosCatalogueController,
        ],
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
    CompanyBranchService,
    CatalogManagementService,
    DeviceManagementService,
    ChartManagementService,
    JournalManagementService,
    PeriodManagementService,
    OfflineGrantSigner,
    OfflineGrantService,
    CashierPinService,
    CashShiftService,
    SaleSyncService,
    CompanyContextService,
    SessionService,
    OidcLoginService,
    SessionAuthenticationGuard,
    ScopedCapabilityGuard,
  ],
})
export class AppModule {}
