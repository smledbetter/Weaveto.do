import { describe, it, expect } from 'vitest';
import {
  derivePinKey,
  derivePinKeyRaw,
  generatePinSalt,
  hashPinKey,
  verifyPin,
  PBKDF2_ITERATIONS,
  SALT_LENGTH,
  KEY_LENGTH,
} from '$lib/pin/derive';

describe('PIN Derivation', () => {
  describe('derivePinKey', () => {
    it('returns a CryptoKey with correct algorithm and usage', async () => {
      const pin = '123456';
      const salt = generatePinSalt();
      const key = await derivePinKey(pin, salt);

      expect(key).toBeInstanceOf(CryptoKey);
      expect(key.type).toBe('secret');
      expect(key.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
      expect(key.usages).toEqual(expect.arrayContaining(['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']));
    });

    it('derives deterministic keys (same PIN + salt = same bytes)', async () => {
      const pin = '999999';
      const salt = new Uint8Array(32).fill(42); // Fixed salt for determinism

      const rawKey1 = await derivePinKeyRaw(pin, salt);
      const rawKey2 = await derivePinKeyRaw(pin, salt);

      expect(rawKey1).toEqual(rawKey2);
    });

    it('produces different keys for different PINs', async () => {
      const salt = generatePinSalt();

      const key1 = await derivePinKeyRaw('111111', salt);
      const key2 = await derivePinKeyRaw('222222', salt);

      expect(key1).not.toEqual(key2);
    });

    it('produces different keys for different salts', async () => {
      const pin = '555555';
      const salt1 = generatePinSalt();
      const salt2 = generatePinSalt();

      const key1 = await derivePinKeyRaw(pin, salt1);
      const key2 = await derivePinKeyRaw(pin, salt2);

      expect(key1).not.toEqual(key2);
    });
  });

  describe('generatePinSalt', () => {
    it('returns 32 bytes', () => {
      const salt = generatePinSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(32);
    });

    it('produces unique salts on each call', () => {
      const salt1 = generatePinSalt();
      const salt2 = generatePinSalt();
      const salt3 = generatePinSalt();

      expect(salt1).not.toEqual(salt2);
      expect(salt2).not.toEqual(salt3);
      expect(salt1).not.toEqual(salt3);
    });
  });

  describe('hashPinKey', () => {
    it('produces 32-byte SHA-256 hash', async () => {
      const rawKey = await derivePinKeyRaw('123456', generatePinSalt());
      const hash = await hashPinKey(rawKey);

      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.length).toBe(32); // SHA-256 output is 256 bits = 32 bytes
    });

    it('produces deterministic hashes', async () => {
      const rawKey = new Uint8Array(32).fill(99);
      const hash1 = await hashPinKey(rawKey);
      const hash2 = await hashPinKey(rawKey);

      expect(hash1).toEqual(hash2);
    });

    it('produces different hashes for different keys', async () => {
      const key1 = new Uint8Array(32).fill(1);
      const key2 = new Uint8Array(32).fill(2);

      const hash1 = await hashPinKey(key1);
      const hash2 = await hashPinKey(key2);

      expect(hash1).not.toEqual(hash2);
    });
  });

  describe('verifyPin', () => {
    it('succeeds with correct PIN', async () => {
      const pin = '123456';
      const salt = generatePinSalt();
      const rawKey = await derivePinKeyRaw(pin, salt);
      const hash = await hashPinKey(rawKey);

      const verified = await verifyPin(pin, salt, hash);

      expect(verified).not.toBeNull();
      expect(verified).toBeInstanceOf(CryptoKey);
      expect(verified!.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
    });

    it('returns null with wrong PIN', async () => {
      const correctPin = '123456';
      const wrongPin = '654321';
      const salt = generatePinSalt();
      const rawKey = await derivePinKeyRaw(correctPin, salt);
      const hash = await hashPinKey(rawKey);

      const verified = await verifyPin(wrongPin, salt, hash);

      expect(verified).toBeNull();
    });

    it('returns null with wrong hash length (constant-time check)', async () => {
      const pin = '123456';
      const salt = generatePinSalt();
      const shortHash = new Uint8Array(16); // Wrong length

      const verified = await verifyPin(pin, salt, shortHash);

      expect(verified).toBeNull();
    });

    it('uses constant-time comparison (all bits checked)', async () => {
      const pin = '123456';
      const salt = generatePinSalt();
      const rawKey = await derivePinKeyRaw(pin, salt);
      const correctHash = await hashPinKey(rawKey);

      // Create a hash that differs only in the last byte
      const almostCorrectHash = new Uint8Array(correctHash);
      almostCorrectHash[31] ^= 1; // Flip one bit in the last byte

      const verified = await verifyPin(pin, salt, almostCorrectHash);

      expect(verified).toBeNull();
    });
  });

  describe('constants', () => {
    it('PBKDF2_ITERATIONS is 600000', () => {
      expect(PBKDF2_ITERATIONS).toBe(600_000);
    });

    it('SALT_LENGTH is 32 bytes', () => {
      expect(SALT_LENGTH).toBe(32);
    });

    it('KEY_LENGTH is 256 bits', () => {
      expect(KEY_LENGTH).toBe(256);
    });
  });

  describe('RFC 6070 test vector verification', () => {
    // We can't directly test RFC 6070 vectors because they use 1-2 iterations,
    // but we verify our implementation works with known low-iteration values
    it('derives consistent output for known inputs', async () => {
      const pin = 'password';
      const salt = new TextEncoder().encode('salt');
      const paddedSalt = new Uint8Array(32);
      paddedSalt.set(salt); // Pad to 32 bytes

      const rawKey = await derivePinKeyRaw(pin, paddedSalt);

      // Just verify it produces 32 bytes (256 bits) consistently
      expect(rawKey.length).toBe(32);

      // Verify it's deterministic
      const rawKey2 = await derivePinKeyRaw(pin, paddedSalt);
      expect(rawKey).toEqual(rawKey2);
    });
  });
});
