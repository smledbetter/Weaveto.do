// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { deriveEmojiString, EMOJI_PALETTE } from '$lib/room/verification';

describe('EMOJI_PALETTE', () => {
  it('has exactly 256 entries', () => {
    expect(EMOJI_PALETTE).toHaveLength(256);
  });

  it('has no duplicate emoji', () => {
    const unique = new Set(EMOJI_PALETTE);
    expect(unique.size).toBe(256);
  });
});

describe('deriveEmojiString', () => {
  const keyA = 'abc123def456';
  const keyB = 'xyz789uvw012';

  it('returns 5 emoji separated by spaces', async () => {
    const result = await deriveEmojiString(keyA, keyB);
    const parts = result.split(' ');
    expect(parts).toHaveLength(5);
  });

  it('is deterministic (same inputs, same output)', async () => {
    const r1 = await deriveEmojiString(keyA, keyB);
    const r2 = await deriveEmojiString(keyA, keyB);
    expect(r1).toBe(r2);
  });

  it('is commutative (order does not matter)', async () => {
    const ab = await deriveEmojiString(keyA, keyB);
    const ba = await deriveEmojiString(keyB, keyA);
    expect(ab).toBe(ba);
  });

  it('produces different results for different key pairs', async () => {
    const r1 = await deriveEmojiString(keyA, keyB);
    const r2 = await deriveEmojiString(keyA, 'different_key_999');
    expect(r1).not.toBe(r2);
  });

  it('all emoji are from the palette', async () => {
    const result = await deriveEmojiString(keyA, keyB);
    const parts = result.split(' ');
    for (const emoji of parts) {
      expect(EMOJI_PALETTE).toContain(emoji);
    }
  });

  it('handles identical keys', async () => {
    // Edge case: both keys the same (e.g., comparing self)
    const result = await deriveEmojiString(keyA, keyA);
    const parts = result.split(' ');
    expect(parts).toHaveLength(5);
  });
});
