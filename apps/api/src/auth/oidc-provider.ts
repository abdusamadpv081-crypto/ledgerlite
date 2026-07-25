import {
  ClientSecretBasic,
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
} from "openid-client";

export const OIDC_SETTINGS = Symbol("OIDC_SETTINGS");
export const OIDC_PROVIDER = Symbol("OIDC_PROVIDER");
export const OIDC_TRANSACTION_CIPHER = Symbol("OIDC_TRANSACTION_CIPHER");

const OIDC_ENVIRONMENT_KEYS = [
  "OIDC_ISSUER_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_REDIRECT_URI",
  "OIDC_TRANSACTION_ENCRYPTION_KEY",
] as const;

export type OidcSettings = Readonly<{
  clientId: string;
  clientSecret?: string;
  issuerUrl: URL;
  redirectUri: URL;
  transactionEncryptionKey: Buffer;
  useInsecureDevelopmentIssuer: boolean;
}>;

export type OidcAuthorizationRequest = Readonly<{
  authorizationUrl: URL;
  nonce: string;
  pkceCodeVerifier: string;
  state: string;
}>;

export type OidcIdentity = Readonly<{
  providerId: string;
  subject: string;
}>;

export interface OidcProvider {
  isConfigured(): boolean;
  startAuthorization(): Promise<OidcAuthorizationRequest>;
  exchangeAuthorizationCode(
    callbackUrl: URL,
    checks: Readonly<{
      nonce: string;
      pkceCodeVerifier: string;
      state: string;
    }>,
  ): Promise<OidcIdentity>;
}

function requireUrl(value: string, environmentName: string): URL {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      throw new Error("credentials are not allowed");
    }
    return url;
  } catch {
    throw new Error(
      `${environmentName} must be an absolute URL without credentials.`,
    );
  }
}

export function loadOidcSettings(
  environment: NodeJS.ProcessEnv = process.env,
): OidcSettings | undefined {
  const values = OIDC_ENVIRONMENT_KEYS.map((key) => environment[key]?.trim());
  if (values.every((value) => !value)) {
    return undefined;
  }
  if (values.some((value) => !value)) {
    throw new Error(
      `OIDC configuration is incomplete. Set ${OIDC_ENVIRONMENT_KEYS.join(", ")}.`,
    );
  }

  const [issuerValue, clientId, clientSecret, redirectValue, keyValue] =
    values as [string, string, string, string, string];
  const issuerUrl = requireUrl(issuerValue, "OIDC_ISSUER_URL");
  const redirectUri = requireUrl(redirectValue, "OIDC_REDIRECT_URI");
  const isDevelopment = environment.NODE_ENV === "development";

  if (
    (issuerUrl.protocol !== "https:" || redirectUri.protocol !== "https:") &&
    !isDevelopment
  ) {
    throw new Error(
      "OIDC issuer and redirect URLs must use HTTPS outside development.",
    );
  }

  const transactionEncryptionKey = Buffer.from(keyValue, "base64url");
  if (transactionEncryptionKey.length !== 32) {
    throw new Error(
      "OIDC_TRANSACTION_ENCRYPTION_KEY must be a base64url-encoded 32-byte key.",
    );
  }

  return {
    clientId,
    clientSecret: clientSecret || undefined,
    issuerUrl,
    redirectUri,
    transactionEncryptionKey,
    useInsecureDevelopmentIssuer:
      isDevelopment && issuerUrl.protocol === "http:",
  };
}

export class OpenIdConnectProvider implements OidcProvider {
  private configurationPromise: Promise<Configuration> | undefined;

  constructor(private readonly settings: OidcSettings | undefined) {}

  isConfigured(): boolean {
    return this.settings !== undefined;
  }

  async startAuthorization(): Promise<OidcAuthorizationRequest> {
    const [configuration, pkceCodeVerifier] = await Promise.all([
      this.configuration(),
      Promise.resolve(randomPKCECodeVerifier()),
    ]);
    const [codeChallenge, state, nonce] = await Promise.all([
      calculatePKCECodeChallenge(pkceCodeVerifier),
      Promise.resolve(randomState()),
      Promise.resolve(randomNonce()),
    ]);
    const settings = this.requiredSettings();

    return {
      authorizationUrl: buildAuthorizationUrl(configuration, {
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        nonce,
        redirect_uri: settings.redirectUri.toString(),
        response_type: "code",
        scope: "openid profile email",
        state,
      }),
      nonce,
      pkceCodeVerifier,
      state,
    };
  }

  async exchangeAuthorizationCode(
    callbackUrl: URL,
    checks: Readonly<{
      nonce: string;
      pkceCodeVerifier: string;
      state: string;
    }>,
  ): Promise<OidcIdentity> {
    const tokens = await authorizationCodeGrant(
      await this.configuration(),
      callbackUrl,
      {
        expectedNonce: checks.nonce,
        expectedState: checks.state,
        pkceCodeVerifier: checks.pkceCodeVerifier,
      },
    );
    const subject = tokens.claims()?.sub;
    if (typeof subject !== "string" || !subject.trim()) {
      throw new Error("OIDC provider did not return an ID token subject.");
    }

    return {
      providerId: this.requiredSettings().issuerUrl.toString(),
      subject,
    };
  }

  private async configuration(): Promise<Configuration> {
    this.configurationPromise ??= this.discover();
    return this.configurationPromise;
  }

  private async discover(): Promise<Configuration> {
    const settings = this.requiredSettings();
    return discovery(
      settings.issuerUrl,
      settings.clientId,
      {
        redirect_uris: [settings.redirectUri.toString()],
        response_types: ["code"],
      },
      settings.clientSecret
        ? ClientSecretBasic(settings.clientSecret)
        : undefined,
      settings.useInsecureDevelopmentIssuer
        ? { execute: [allowInsecureRequests] }
        : undefined,
    );
  }

  private requiredSettings(): OidcSettings {
    if (!this.settings) {
      throw new Error("OIDC is not configured for this environment.");
    }
    return this.settings;
  }
}
