import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { DeviceManagementController } from "../src/device/device-management.controller.js";
import type { DeviceManagementService } from "../src/device/device-management.service.js";

const companyId = "c22ff1c3-253f-4457-bcc5-3098d827de20";
const branchId = "d556b3b8-fdbc-4ea6-9c0b-531dd8e704ed";
const deviceId = "f0fd3509-4724-4b95-86c8-d2a4a6f0a204";
const actor = { userId: "dcebc785-a5d1-474b-a5d1-2b27d04e6668" };
const publicKeyJwk = {
  crv: "P-256",
  kty: "EC",
  x: "A".repeat(43),
  y: "B".repeat(43),
} as const;

describe("DeviceManagementController", () => {
  it("validates device registration and status command contracts", () => {
    const calls: unknown[] = [];
    const controller = new DeviceManagementController({
      register: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
      updateStatus: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
    } as unknown as DeviceManagementService);

    controller.register(
      companyId,
      branchId,
      {
        displayName: "Till 1",
        publicKeyJwk,
        appVersion: "1.0.0",
        localSchemaVersion: 1,
      },
      "device-register-1",
      actor,
    );
    controller.updateStatus(
      companyId,
      branchId,
      deviceId,
      {
        expectedUpdatedAt: "2026-07-26T12:00:00.000000Z",
        status: "suspended",
      },
      "device-status-1",
      actor,
    );

    expect(calls).toEqual([
      [
        { companyId, actorUserId: actor.userId },
        branchId,
        {
          displayName: "Till 1",
          publicKeyJwk,
          appVersion: "1.0.0",
          localSchemaVersion: 1,
        },
        "device-register-1",
      ],
      [
        { companyId, actorUserId: actor.userId },
        branchId,
        deviceId,
        {
          expectedUpdatedAt: "2026-07-26T12:00:00.000000Z",
          status: "suspended",
        },
        "device-status-1",
      ],
    ]);
  });

  it("rejects malformed public keys and command identifiers", () => {
    const controller = new DeviceManagementController(
      {} as DeviceManagementService,
    );

    expect(() =>
      controller.register(
        companyId,
        branchId,
        {
          displayName: "Till 1",
          publicKeyJwk: { ...publicKeyJwk, x: "short" },
        },
        "device-register-1",
        actor,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.updateStatus(
        companyId,
        branchId,
        deviceId,
        {
          expectedUpdatedAt: "2026-07-26T12:00:00Z",
          status: "retired",
        },
        "short",
        actor,
      ),
    ).toThrow(BadRequestException);
  });
});
