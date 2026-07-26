import { Controller, Get, Inject, Param, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  CurrentActor,
  RequireCapability,
} from "../auth/authorization.decorators.js";
import { ScopedCapabilityGuard } from "../auth/scoped-capability.guard.js";
import { SessionAuthenticationGuard } from "../auth/session-authentication.guard.js";
import type { AuthenticatedActor } from "../auth/session.service.js";
import { CatalogManagementService } from "./catalog-management.service.js";

const id = z.string().uuid();

@Controller("companies/:companyId/branches/:branchId/pos/catalogue")
@UseGuards(SessionAuthenticationGuard, ScopedCapabilityGuard)
@RequireCapability("pos.sale.create")
export class PosCatalogueController {
  constructor(
    @Inject(CatalogManagementService)
    private readonly catalogue: CatalogManagementService,
  ) {}

  @Get()
  list(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.catalogue.listPosCatalogue({
      companyId: id.parse(companyId),
      branchId: id.parse(branchId),
      actorUserId: actor.userId,
    });
  }
}
