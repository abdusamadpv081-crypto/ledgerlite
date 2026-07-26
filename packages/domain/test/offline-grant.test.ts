import { describe, expect, it } from "vitest";
import {
  OFFLINE_GRANT_CHALLENGE_CONTEXT,
  offlineGrantChallengePayload,
} from "../src/offline-grant.js";

describe("offline grant challenge payload", () => {
  it("binds the protocol version, challenge ID, and nonce deterministically", () => {
    expect(
      new TextDecoder().decode(
        offlineGrantChallengePayload("challenge-id", "challenge-nonce"),
      ),
    ).toBe(`${OFFLINE_GRANT_CHALLENGE_CONTEXT}:challenge-id:challenge-nonce`);
  });
});
