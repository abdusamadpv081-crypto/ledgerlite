import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";
import {
  OpenIdConnectProvider,
  loadOidcSettings,
} from "../src/auth/oidc-provider.js";

function configuredEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    OIDC_CLIENT_ID: "ledgerlite-api",
    OIDC_CLIENT_SECRET: "test-client-secret",
    OIDC_ISSUER_URL: "https://identity.ledgerlite.test/",
    OIDC_REDIRECT_URI: "https://app.ledgerlite.test/api/v1/auth/callback",
    OIDC_TRANSACTION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
    ...overrides,
  };
}

describe("OIDC configuration", () => {
  it("allows OIDC to be disabled but rejects partial or insecure production configuration", () => {
    expect(loadOidcSettings({})).toBeUndefined();
    expect(() =>
      loadOidcSettings({ OIDC_ISSUER_URL: "https://identity.example" }),
    ).toThrow(/incomplete/i);
    expect(() =>
      loadOidcSettings(
        configuredEnvironment({ OIDC_ISSUER_URL: "http://identity.example" }),
      ),
    ).toThrow(/HTTPS/i);
  });

  it("requires a canonical 32-byte transaction encryption key", () => {
    expect(() =>
      loadOidcSettings(
        configuredEnvironment({ OIDC_TRANSACTION_ENCRYPTION_KEY: "not-a-key" }),
      ),
    ).toThrow(/base64url-encoded 32-byte key/i);
  });

  it("uses the configured callback origin and path when accepting the provider response", () => {
    const provider = new OpenIdConnectProvider(
      loadOidcSettings(configuredEnvironment()),
    );

    expect(
      provider
        .callbackUrl(
          "https://untrusted.example/api/v1/auth/callback?code=code&state=state",
        )
        .toString(),
    ).toBe(
      "https://app.ledgerlite.test/api/v1/auth/callback?code=code&state=state",
    );
    expect(() => provider.callbackUrl("/unexpected?code=code")).toThrow(
      /does not match/i,
    );
  });
});
