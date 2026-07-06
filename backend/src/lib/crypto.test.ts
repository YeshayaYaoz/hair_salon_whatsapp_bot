import { describe, it, expect, beforeEach } from "vitest";

describe("crypto (encryptSecret/decryptSecret)", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-vitest";
  });

  it("round-trips a plaintext string through encrypt then decrypt", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto.js");
    const original = "sk-test-some-whatsapp-access-token-1234";
    const encrypted = encryptSecret(original);
    expect(decryptSecret(encrypted)).toBe(original);
  });

  it("never stores the plaintext inside the encrypted output", async () => {
    const { encryptSecret } = await import("./crypto.js");
    const original = "super-secret-token-value";
    const encrypted = encryptSecret(original);
    expect(encrypted).not.toContain(original);
  });

  it("produces different ciphertext for the same plaintext on repeated calls (random IV)", async () => {
    const { encryptSecret } = await import("./crypto.js");
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
  });

  it("stores as iv:authTag:ciphertext, all base64", async () => {
    const { encryptSecret } = await import("./crypto.js");
    const parts = encryptSecret("hello").split(":");
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(() => Buffer.from(part, "base64")).not.toThrow();
    }
  });

  it("rejects a tampered ciphertext instead of silently returning garbage (GCM integrity check)", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto.js");
    const encrypted = encryptSecret("do-not-tamper-with-me");
    const [iv, authTag, ciphertext] = encrypted.split(":");
    // Flip a byte in the ciphertext.
    const buf = Buffer.from(ciphertext, "base64");
    buf[0] = buf[0] ^ 0xff;
    const tampered = [iv, authTag, buf.toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws a clear error when TOKEN_ENCRYPTION_KEY is not set", async () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    const { encryptSecret } = await import("./crypto.js");
    expect(() => encryptSecret("anything")).toThrow("TOKEN_ENCRYPTION_KEY is not set");
  });
});
