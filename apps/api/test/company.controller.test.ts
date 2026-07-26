import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { CompanyController } from "../src/company/company.controller.js";
import type { CompanyBranchService } from "../src/company/company-branch.service.js";

const actor = { userId: "f0fd3509-4724-4b95-86c8-d2a4a6f0a204" };
const companyId = "c22ff1c3-253f-4457-bcc5-3098d827de20";
const branchId = "d556b3b8-fdbc-4ea6-9c0b-531dd8e704ed";

describe("CompanyController", () => {
  it("normalizes validated company changes before issuing the command", () => {
    const calls: unknown[] = [];
    const controller = new CompanyController({
      updateCompany: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
    } as unknown as CompanyBranchService);

    expect(
      controller.updateCompany(
        companyId,
        {
          expectedUpdatedAt: "2026-07-26T12:00:00.123456Z",
          baseCurrency: "usd",
          trn: null,
        },
        "company-update-1",
        actor,
      ),
    ).toEqual({ accepted: true });
    expect(calls).toEqual([
      [
        { actorUserId: actor.userId, companyId },
        {
          expectedUpdatedAt: "2026-07-26T12:00:00.123456Z",
          baseCurrency: "USD",
          trn: null,
        },
        "company-update-1",
      ],
    ]);
  });

  it("defaults and normalizes a branch create command", () => {
    const calls: unknown[] = [];
    const controller = new CompanyController({
      createBranch: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
    } as unknown as CompanyBranchService);

    controller.createBranch(
      companyId,
      { code: " second-store ", name: "Second store" },
      "branch-create-1",
      actor,
    );

    expect(calls).toEqual([
      [
        { actorUserId: actor.userId, companyId },
        {
          code: "SECOND-STORE",
          name: "Second store",
          address: {},
          timeZone: "Asia/Dubai",
          status: "active",
        },
        "branch-create-1",
      ],
    ]);
  });

  it("rejects incomplete edits and malformed command identifiers", () => {
    const controller = new CompanyController(
      {} as CompanyBranchService,
    );

    expect(() =>
      controller.updateBranch(
        companyId,
        branchId,
        { expectedUpdatedAt: "2026-07-26T12:00:00Z" },
        "branch-update-1",
        actor,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.createBranch(
        companyId,
        { code: "MAIN", name: "Main" },
        "short",
        actor,
      ),
    ).toThrow(BadRequestException);
  });
});
