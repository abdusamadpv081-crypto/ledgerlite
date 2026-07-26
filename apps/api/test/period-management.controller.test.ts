import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { PeriodManagementController } from "../src/accounting/period-management.controller.js";
import type { PeriodManagementService } from "../src/accounting/period-management.service.js";

const companyId = "c22ff1c3-253f-4457-bcc5-3098d827de20";
const periodId = "d556b3b8-fdbc-4ea6-9c0b-531dd8e704ed";
const actor = { userId: "dcebc785-a5d1-474b-a5d1-2b27d04e6668" };

describe("PeriodManagementController", () => {
  it("validates fiscal period create and close commands", () => {
    const calls: unknown[] = [];
    const controller = new PeriodManagementController({
      create: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
      close: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
    } as unknown as PeriodManagementService);

    controller.create(
      companyId,
      { name: "FY 2026", startsOn: "2026-01-01", endsOn: "2027-01-01" },
      "period-create-1",
      actor,
    );
    controller.close(
      companyId,
      periodId,
      { expectedUpdatedAt: "2026-07-26T12:00:00.000000Z" },
      "period-close-1",
      actor,
    );

    expect(calls).toEqual([
      [
        { companyId, actorUserId: actor.userId },
        { name: "FY 2026", startsOn: "2026-01-01", endsOn: "2027-01-01" },
        "period-create-1",
      ],
      [
        { companyId, actorUserId: actor.userId },
        periodId,
        { expectedUpdatedAt: "2026-07-26T12:00:00.000000Z" },
        "period-close-1",
      ],
    ]);
  });

  it("rejects invalid period dates and command keys", () => {
    const controller = new PeriodManagementController(
      {} as PeriodManagementService,
    );

    expect(() =>
      controller.create(
        companyId,
        { name: "FY 2026", startsOn: "2027-01-01", endsOn: "2026-01-01" },
        "period-create-1",
        actor,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.close(
        companyId,
        periodId,
        { expectedUpdatedAt: "2026-07-26T12:00:00Z" },
        "short",
        actor,
      ),
    ).toThrow(BadRequestException);
  });
});
