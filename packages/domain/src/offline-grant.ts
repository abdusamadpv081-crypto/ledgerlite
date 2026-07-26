export const OFFLINE_GRANT_CHALLENGE_CONTEXT =
  "ledgerlite:offline-grant-challenge:v1";

export function offlineGrantChallengePayload(
  challengeId: string,
  nonce: string,
): Uint8Array {
  return new TextEncoder().encode(
    `${OFFLINE_GRANT_CHALLENGE_CONTEXT}:${challengeId}:${nonce}`,
  );
}
