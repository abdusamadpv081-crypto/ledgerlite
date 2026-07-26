import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { CatalogManagementController } from "../src/catalog/catalog-management.controller.js";
import type { CatalogManagementService } from "../src/catalog/catalog-management.service.js";

const companyId = "c22ff1c3-253f-4457-bcc5-3098d827de20";
const actor = { userId: "f0fd3509-4724-4b95-86c8-d2a4a6f0a204" };

describe("CatalogManagementController", () => {
  it("normalizes and validates tax and product create commands", () => {
    const calls: unknown[] = [];
    const controller = new CatalogManagementController({
      createTaxCode: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
      createProduct: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
    } as unknown as CatalogManagementService);

    controller.createTax(
      companyId,
      { code: " vat5 ", name: "VAT 5%", rate: "0.05" },
      "tax-create-1",
      actor,
    );
    controller.createProduct(
      companyId,
      { name: "Coffee", unitPrice: "12.50" },
      "product-create-1",
      actor,
    );

    expect(calls).toEqual([
      [
        { companyId, actorUserId: actor.userId },
        { code: "VAT5", name: "VAT 5%", rate: "0.05" },
        "tax-create-1",
      ],
      [
        { companyId, actorUserId: actor.userId },
        {
          name: "Coffee",
          unitPrice: "12.50",
          productKind: "stock",
          priceListName: "Default retail",
        },
        "product-create-1",
      ],
    ]);
  });

  it("rejects malformed price data and command keys", () => {
    const controller = new CatalogManagementController(
      {} as CatalogManagementService,
    );

    expect(() =>
      controller.createProduct(
        companyId,
        { name: "Coffee", unitPrice: "12.1234567" },
        "product-create-1",
        actor,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.createTax(
        companyId,
        { code: "VAT5", name: "VAT 5%", rate: "0.05" },
        "short",
        actor,
      ),
    ).toThrow(BadRequestException);
  });
});
