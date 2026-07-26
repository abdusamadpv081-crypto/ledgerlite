import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  OfflineGrantController,
  OfflineGrantVerificationKeyController,
} from "../src/pos/offline-grant.controller.js";
import type { OfflineGrantService } from "../src/pos/offline-grant.service.js";

const companyId = "c22ff1c3-253f-4457-bcc5-3098d827de20";
const branchId = "d556b3b8-fdbc-4ea6-9c0b-531dd8e704ed";
const deviceId = "f0fd3509-4724-4b95-86c8-d2a4a6f0a204";
const challengeId = "f8569e10-9fcf-47dc-a0a5-51cb4600e620";
const actor = { userId: "dcebc785-a5d1-474b-a5d1-2b27d04e6668" };
const nonce = "a".repeat(43);
const signature = "b".repeat(86);

describe("OfflineGrantController", () => {
  it("validates and forwards device-proof grant commands", () => {
    const calls: unknown[] = [];
    const controller = new OfflineGrantController({
      createChallenge: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
      issue: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
    } as unknown as OfflineGrantService);

    controller.challenge(
      companyId,
      branchId,
      { deviceId },
      "offline-grant-challenge-1",
      actor,
    );
    controller.issue(
      companyId,
      branchId,
      { challengeId, nonce, signature },
      "offline-grant-issue-1",
      actor,
    );

    expect(calls).toEqual([
      [
        { companyId, actorUserId: actor.userId },
        branchId,
        deviceId,
        "offline-grant-challenge-1",
      ],
      [
        { companyId, actorUserId: actor.userId },
        branchId,
        { challengeId, nonce, signature },
        "offline-grant-issue-1",
      ],
    ]);
  });

  it("rejects malformed grant proofs and command identifiers", () => {
    const controller = new OfflineGrantController({} as OfflineGrantService);

    expect(() =>
      controller.challenge(
        companyId,
        branchId,
        { deviceId: "not-a-uuid" },
        "offline-grant-challenge-1",
        actor,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.issue(
        companyId,
        branchId,
        { challengeId, nonce: "short", signature },
        "offline-grant-issue-1",
        actor,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.issue(
        companyId,
        branchId,
        { challengeId, nonce, signature },
        "short",
        actor,
      ),
    ).toThrow(BadRequestException);
  });
});

describe("OfflineGrantVerificationKeyController", () => {
  it("exposes the configured verification key without accepting input", () => {
    const key = {
      algorithm: "ES256" as const,
      keyId: "offline-grant-key-1",
      publicKeyJwk: { crv: "P-256", kty: "EC", x: "x", y: "y" },
    };
    const controller = new OfflineGrantVerificationKeyController({
      verificationKey: () => key,
    } as unknown as OfflineGrantService);

    expect(controller.verificationKey()).toEqual(key);
  });
});
