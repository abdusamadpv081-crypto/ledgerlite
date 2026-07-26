import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { CashShiftController } from "../src/pos/cash-shift.controller.js";
import type { CashShiftService } from "../src/pos/cash-shift.service.js";

const companyId = "c22ff1c3-253f-4457-bcc5-3098d827de20";
const branchId = "d556b3b8-fdbc-4ea6-9c0b-531dd8e704ed";
const deviceId = "f0fd3509-4724-4b95-86c8-d2a4a6f0a204";
const actor = { userId: "dcebc785-a5d1-474b-a5d1-2b27d04e6668" };

describe("CashShiftController", () => {
  it("validates and forwards an opening command and current-shift lookup", () => {
    const calls: unknown[] = [];
    const controller = new CashShiftController({
      current: (...args: unknown[]) => {
        calls.push(args);
        return null;
      },
      open: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
    } as unknown as CashShiftService);

    controller.current(companyId, branchId, actor);
    controller.open(
      companyId,
      branchId,
      { deviceId, openingFloat: "125.50" },
      "cash-shift-open-1",
      actor,
    );

    expect(calls).toEqual([
      [{ companyId, actorUserId: actor.userId }, branchId],
      [
        { companyId, actorUserId: actor.userId },
        branchId,
        { deviceId, openingFloat: "125.50" },
        "cash-shift-open-1",
      ],
    ]);
  });

  it("rejects invalid cash amounts and command identifiers", () => {
    const controller = new CashShiftController({} as CashShiftService);

    expect(() =>
      controller.open(
        companyId,
        branchId,
        { deviceId, openingFloat: "1.001" },
        "cash-shift-open-1",
        actor,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.open(
        companyId,
        branchId,
        { deviceId, openingFloat: "125.50" },
        "short",
        actor,
      ),
    ).toThrow(BadRequestException);
  });
});
