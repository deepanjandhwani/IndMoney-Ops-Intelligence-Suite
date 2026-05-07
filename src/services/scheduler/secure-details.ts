import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type SecureDetailsPayload = {
  customer_email: string;
  customer_name?: string;
};

const TOKEN_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export function createSecureDetailsToken() {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashSecureDetailsToken(token)
  };
}

export function hashSecureDetailsToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function secureDetailsExpiry(now: Date = new Date()) {
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt.toISOString();
}

export function encryptSecureDetails(
  payload: SecureDetailsPayload,
  secret = process.env.SECURE_DETAILS_ENCRYPTION_KEY
) {
  const key = encryptionKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_BYTES
  });
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecureDetails(
  ciphertext: string,
  secret = process.env.SECURE_DETAILS_ENCRYPTION_KEY
): SecureDetailsPayload {
  const [ivEncoded, authTagEncoded, ciphertextEncoded] = ciphertext.split(".");
  if (!ivEncoded || !authTagEncoded || !ciphertextEncoded) {
    throw new Error("Invalid secure details ciphertext.");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(ivEncoded, "base64url"), {
    authTagLength: AUTH_TAG_BYTES
  });
  decipher.setAuthTag(Buffer.from(authTagEncoded, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final()
  ]).toString("utf8");

  return JSON.parse(plaintext) as SecureDetailsPayload;
}

function encryptionKey(secret?: string) {
  const value = secret?.trim();
  if (!value) {
    throw new Error("Missing SECURE_DETAILS_ENCRYPTION_KEY.");
  }

  return createHash("sha256").update(value).digest();
}
