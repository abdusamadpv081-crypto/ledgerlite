import "reflect-metadata";

import { describe, expect, it } from "vitest";
import { PosCatalogueController } from "../src/catalog/pos-catalogue.controller.js";
import type { CatalogManagementService } from "../src/catalog/catalog-management.service.js";

const companyId = "c22ff1c3-253f-4457-bcc5-3098d827de20";
const branchId = "d556b3b8-fdbc-4ea6-9c0b-531dd8e704ed";
const actor = { userId: "f0fd3509-4724-4b95-86c8-d2a4a6f0a204" };

describe("PosCatalogueController", () => {
  it("requests the active branch catalogue in the cashier's company context", () => {
    const calls: unknown[] = [];
    const controller = new PosCatalogueController({
      listPosCatalogue: (...args: unknown[]) => {
        calls.push(args);
        return { products: [], refreshedAt: "2026-07-26T12:00:00.000Z" };
      },
    } as unknown as CatalogManagementService);

    controller.list(companyId, branchId, actor);

    expect(calls).toEqual([
      [{ companyId, branchId, actorUserId: actor.userId }],
    ]);
  });

  it("rejects malformed company and branch identifiers", () => {
    const controller = new PosCatalogueController(
      {} as CatalogManagementService,
    );

    expect(() => controller.list("not-a-uuid", branchId, actor)).toThrow();
    expect(() => controller.list(companyId, "not-a-uuid", actor)).toThrow();
  });
});
