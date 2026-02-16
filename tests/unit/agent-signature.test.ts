// @vitest-environment node
/**
 * Unit tests for Ed25519 module signature verification.
 */

import { describe, it, expect } from "vitest";
import {
  verifyModuleSignature,
  signModuleHash,
  generateSigningKeypair,
} from "../../src/lib/agents/signature";
import { verifyManifestSignature } from "../../src/lib/agents/loader";
import type { AgentManifest } from "../../src/lib/agents/types";

describe("Ed25519 Module Signatures", () => {
  describe("verifyModuleSignature", () => {
    it("verifies a valid signature", async () => {
      const { publicKeyBase64, privateKeyPkcs8 } =
        await generateSigningKeypair();
      const wasmHash =
        "abc123def456abc123def456abc123def456abc123def456abc123def456abcd";
      const signature = await signModuleHash(wasmHash, privateKeyPkcs8);

      const valid = await verifyModuleSignature(
        wasmHash,
        signature,
        publicKeyBase64,
      );
      expect(valid).toBe(true);
    });

    it("rejects signature with wrong public key", async () => {
      const keypair1 = await generateSigningKeypair();
      const keypair2 = await generateSigningKeypair();
      const wasmHash = "deadbeef".repeat(8);
      const signature = await signModuleHash(
        wasmHash,
        keypair1.privateKeyPkcs8,
      );

      const valid = await verifyModuleSignature(
        wasmHash,
        signature,
        keypair2.publicKeyBase64,
      );
      expect(valid).toBe(false);
    });

    it("rejects signature for tampered hash", async () => {
      const { publicKeyBase64, privateKeyPkcs8 } =
        await generateSigningKeypair();
      const wasmHash = "aabbccdd".repeat(8);
      const signature = await signModuleHash(wasmHash, privateKeyPkcs8);

      const valid = await verifyModuleSignature(
        "different_hash",
        signature,
        publicKeyBase64,
      );
      expect(valid).toBe(false);
    });

    it("returns false for invalid base64 signature", async () => {
      const { publicKeyBase64 } = await generateSigningKeypair();
      const valid = await verifyModuleSignature(
        "somehash",
        "not-valid-base64!!!",
        publicKeyBase64,
      );
      expect(valid).toBe(false);
    });

    it("returns false for wrong-length public key", async () => {
      const { privateKeyPkcs8 } = await generateSigningKeypair();
      const wasmHash = "aabbccdd".repeat(8);
      const signature = await signModuleHash(wasmHash, privateKeyPkcs8);

      // 16 bytes instead of 32
      const shortKey = btoa(
        String.fromCharCode(...new Uint8Array(16).fill(0)),
      );
      const valid = await verifyModuleSignature(wasmHash, signature, shortKey);
      expect(valid).toBe(false);
    });

    it("returns false for wrong-length signature", async () => {
      const { publicKeyBase64 } = await generateSigningKeypair();
      // 32 bytes instead of 64
      const shortSig = btoa(
        String.fromCharCode(...new Uint8Array(32).fill(0)),
      );
      const valid = await verifyModuleSignature(
        "somehash",
        shortSig,
        publicKeyBase64,
      );
      expect(valid).toBe(false);
    });
  });

  describe("signModuleHash", () => {
    it("produces a 64-byte signature", async () => {
      const { privateKeyPkcs8 } = await generateSigningKeypair();
      const signature = await signModuleHash("testhash", privateKeyPkcs8);
      const bytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
      expect(bytes.length).toBe(64);
    });

    it("produces deterministic signatures for same input", async () => {
      const { privateKeyPkcs8 } = await generateSigningKeypair();
      const sig1 = await signModuleHash("samehash", privateKeyPkcs8);
      const sig2 = await signModuleHash("samehash", privateKeyPkcs8);
      expect(sig1).toBe(sig2);
    });

    it("produces different signatures for different hashes", async () => {
      const { privateKeyPkcs8 } = await generateSigningKeypair();
      const sig1 = await signModuleHash("hash1", privateKeyPkcs8);
      const sig2 = await signModuleHash("hash2", privateKeyPkcs8);
      expect(sig1).not.toBe(sig2);
    });
  });

  describe("generateSigningKeypair", () => {
    it("generates a 32-byte public key", async () => {
      const { publicKeyBase64 } = await generateSigningKeypair();
      const bytes = Uint8Array.from(atob(publicKeyBase64), (c) =>
        c.charCodeAt(0),
      );
      expect(bytes.length).toBe(32);
    });

    it("generates unique keypairs", async () => {
      const kp1 = await generateSigningKeypair();
      const kp2 = await generateSigningKeypair();
      expect(kp1.publicKeyBase64).not.toBe(kp2.publicKeyBase64);
    });
  });

  describe("verifyManifestSignature", () => {
    const baseManifest: AgentManifest = {
      name: "test-agent",
      version: "1.0.0",
      description: "Test",
      author: "tester",
      wasmHash: "aabbccdd".repeat(8),
      permissions: ["read_tasks"],
    };

    it("skips verification when no trusted key configured", async () => {
      const result = await verifyManifestSignature(baseManifest, null);
      expect(result).toBeNull();
    });

    it("allows unsigned module when signatures not required", async () => {
      const { publicKeyBase64 } = await generateSigningKeypair();
      const result = await verifyManifestSignature(
        baseManifest,
        publicKeyBase64,
        false,
      );
      expect(result).toBeNull();
    });

    it("rejects unsigned module when signatures required", async () => {
      const { publicKeyBase64 } = await generateSigningKeypair();
      const result = await verifyManifestSignature(
        baseManifest,
        publicKeyBase64,
        true,
      );
      expect(result).toBe("Module signature required but not provided");
    });

    it("accepts validly signed module", async () => {
      const { publicKeyBase64, privateKeyPkcs8 } =
        await generateSigningKeypair();
      const signature = await signModuleHash(
        baseManifest.wasmHash,
        privateKeyPkcs8,
      );
      const manifest = { ...baseManifest, signature };

      const result = await verifyManifestSignature(manifest, publicKeyBase64);
      expect(result).toBeNull();
    });

    it("rejects module with invalid signature", async () => {
      const keypair1 = await generateSigningKeypair();
      const keypair2 = await generateSigningKeypair();
      const signature = await signModuleHash(
        baseManifest.wasmHash,
        keypair2.privateKeyPkcs8,
      );
      const manifest = { ...baseManifest, signature };

      const result = await verifyManifestSignature(
        manifest,
        keypair1.publicKeyBase64,
      );
      expect(result).toBe("Invalid module signature");
    });
  });
});
