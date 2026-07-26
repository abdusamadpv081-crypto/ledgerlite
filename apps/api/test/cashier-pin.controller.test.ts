import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { CashierPinController } from "../src/pos/cashier-pin.controller.js";
import type { CashierPinService } from "../src/pos/cashier-pin.service.js";

const companyId = "c22ff1c3-253f-4457-bcc5-3098d827de20";
const branchId = "d556b3b8-fdbc-4ea6-9c0b-531dd8e704ed";
const deviceId = "f0fd3509-4724-4b95-86c8-d2a4a6f0a204";
const actor = { userId: "dcebc785-a5d1-474b-a5d1-2b27d04e6668" };

describe("CashierPinController", () => {
  it("validates and forwards a cashier's PIN set command", () => {
    const calls: unknown[] = [];
    const controller = new CashierPinController({
      set: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
    } as unknown as CashierPinService);

    controller.set(
      companyId,
      branchId,
      { deviceId, pin: "82537491" },
      "cashier-pin-set-1",
      actor,
    );

    expect(calls).toEqual([
      [
        { companyId, actorUserId: actor.userId },
        branchId,
        { deviceId, pin: "82537491" },
        "cashier-pin-set-1",
      ],
    ]);
  });

  it("rejects invalid PINs and command identifiers", () => {
    const controller = new CashierPinController({} as CashierPinService);

    expect(() =>
      controller.set(
        companyId,
        branchId,
        { deviceId, pin: "1234" },
        "cashier-pin-set-1",
        actor,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.set(
        companyId,
        branchId,
        { deviceId, pin: "82537491" },
        "short",
        actor,
      ),
    ).toThrow(BadRequestException);
  });
});
