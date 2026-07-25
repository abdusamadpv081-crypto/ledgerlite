import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const INITIALIZATION_VECTOR_BYTES = 12;
const AUTHENTICATION_TAG_BYTES = 16;

export class OidcTransactionCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("OIDC transaction cipher key must be 32 bytes.");
    }
  }

  encrypt(value: string): Buffer {
    const initializationVector = randomBytes(INITIALIZATION_VECTOR_BYTES);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.key,
      initializationVector,
    );
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([
      initializationVector,
      cipher.getAuthTag(),
      ciphertext,
    ]);
  }

  decrypt(ciphertext: Buffer): string {
    if (
      ciphertext.length <=
      INITIALIZATION_VECTOR_BYTES + AUTHENTICATION_TAG_BYTES
    ) {
      throw new Error("OIDC transaction ciphertext is malformed.");
    }

    const initializationVector = ciphertext.subarray(
      0,
      INITIALIZATION_VECTOR_BYTES,
    );
    const authenticationTag = ciphertext.subarray(
      INITIALIZATION_VECTOR_BYTES,
      INITIALIZATION_VECTOR_BYTES + AUTHENTICATION_TAG_BYTES,
    );
    const encryptedValue = ciphertext.subarray(
      INITIALIZATION_VECTOR_BYTES + AUTHENTICATION_TAG_BYTES,
    );
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      initializationVector,
    );
    decipher.setAuthTag(authenticationTag);
    return Buffer.concat([
      decipher.update(encryptedValue),
      decipher.final(),
    ]).toString("utf8");
  }
}
