import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ChartManagementController } from "../src/accounting/chart-management.controller.js";
import type { ChartManagementService } from "../src/accounting/chart-management.service.js";

const companyId = "c22ff1c3-253f-4457-bcc5-3098d827de20";
const actor = { userId: "dcebc785-a5d1-474b-a5d1-2b27d04e6668" };

describe("ChartManagementController", () => {
  it("normalizes starter-chart and account commands", () => {
    const calls: unknown[] = [];
    const controller = new ChartManagementController({
      createStarter: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
      createAccount: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
    } as unknown as ChartManagementService);

    controller.createStarter(companyId, {}, "chart-starter-1", actor);
    controller.createAccount(
      companyId,
      { code: " 6100 ", name: "Rent expense", accountType: "expense" },
      "account-create-1",
      actor,
    );

    expect(calls).toEqual([
      [
        { companyId, actorUserId: actor.userId },
        { name: "UAE retail starter chart" },
        "chart-starter-1",
      ],
      [
        { companyId, actorUserId: actor.userId },
        {
          code: "6100",
          name: "Rent expense",
          accountType: "expense",
          isPosting: true,
        },
        "account-create-1",
      ],
    ]);
  });

  it("rejects invalid account identifiers and command keys", () => {
    const controller = new ChartManagementController(
      {} as ChartManagementService,
    );

    expect(() =>
      controller.createAccount(
        companyId,
        { code: "invalid code", name: "Invalid", accountType: "expense" },
        "account-create-1",
        actor,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.createStarter(companyId, {}, "short", actor),
    ).toThrow(BadRequestException);
  });
});
