import { describe, it, expect } from 'vitest';
import { DeliveryTracker } from '$lib/room/delivery';

describe('DeliveryTracker', () => {
  describe('nextSequence', () => {
    it('starts at 1', () => {
      const tracker = new DeliveryTracker();
      expect(tracker.nextSequence()).toBe(1);
    });

    it('increments monotonically', () => {
      const tracker = new DeliveryTracker();
      expect(tracker.nextSequence()).toBe(1);
      expect(tracker.nextSequence()).toBe(2);
      expect(tracker.nextSequence()).toBe(3);
    });
  });

  describe('checkReceived', () => {
    it('detects no gap when sequences are in order', () => {
      const tracker = new DeliveryTracker();
      expect(tracker.checkReceived('sender1', 1)).toEqual({ gap: false, expected: 1 });
      expect(tracker.checkReceived('sender1', 2)).toEqual({ gap: false, expected: 2 });
      expect(tracker.checkReceived('sender1', 3)).toEqual({ gap: false, expected: 3 });
    });

    it('detects gap when sequence skips', () => {
      const tracker = new DeliveryTracker();
      tracker.checkReceived('sender1', 1);
      const result = tracker.checkReceived('sender1', 3); // skipped 2
      expect(result.gap).toBe(true);
      expect(result.expected).toBe(2);
    });

    it('tracks multiple senders independently', () => {
      const tracker = new DeliveryTracker();
      expect(tracker.checkReceived('sender1', 1)).toEqual({ gap: false, expected: 1 });
      expect(tracker.checkReceived('sender2', 1)).toEqual({ gap: false, expected: 1 });
      expect(tracker.checkReceived('sender1', 2)).toEqual({ gap: false, expected: 2 });
      expect(tracker.checkReceived('sender2', 3)).toEqual({ gap: true, expected: 2 }); // sender2 skipped 2
    });

    it('handles first message from a sender', () => {
      const tracker = new DeliveryTracker();
      // First message from unknown sender, sequence 1 — no gap
      expect(tracker.checkReceived('sender1', 1)).toEqual({ gap: false, expected: 1 });
    });

    it('detects gap if first message is not 1', () => {
      const tracker = new DeliveryTracker();
      // First message with sequence 5 — gap detected (expected 1)
      const result = tracker.checkReceived('sender1', 5);
      expect(result.gap).toBe(true);
      expect(result.expected).toBe(1);
    });
  });

  describe('hasGap', () => {
    it('returns false initially', () => {
      const tracker = new DeliveryTracker();
      expect(tracker.hasGap()).toBe(false);
    });

    it('returns true after gap detected', () => {
      const tracker = new DeliveryTracker();
      tracker.checkReceived('sender1', 1);
      tracker.checkReceived('sender1', 3);
      expect(tracker.hasGap()).toBe(true);
    });

    it('stays true even after in-order messages', () => {
      const tracker = new DeliveryTracker();
      tracker.checkReceived('sender1', 1);
      tracker.checkReceived('sender1', 3); // gap
      tracker.checkReceived('sender1', 4); // back in order
      expect(tracker.hasGap()).toBe(true); // latched
    });
  });

  describe('noteDeliveryFailure', () => {
    /**
     * Sequence gaps only catch messages lost in transit. A key share that will
     * not decrypt is invisible to them: the sender's Megolm key never arrives,
     * so their messages are never counted and never missed.
     */
    it('marks the tracker degraded with no sequence activity at all', () => {
      const tracker = new DeliveryTracker();
      expect(tracker.hasGap()).toBe(false);
      tracker.noteDeliveryFailure();
      expect(tracker.hasGap()).toBe(true);
    });

    it('latches, like a sequence gap does', () => {
      const tracker = new DeliveryTracker();
      tracker.noteDeliveryFailure();
      tracker.checkReceived('sender1', 1);
      tracker.checkReceived('sender1', 2);
      expect(tracker.hasGap()).toBe(true);
    });

    it('is cleared by reset, so a reconnect starts clean', () => {
      const tracker = new DeliveryTracker();
      tracker.noteDeliveryFailure();
      tracker.reset();
      expect(tracker.hasGap()).toBe(false);
    });

    it('does not disturb sequence tracking', () => {
      const tracker = new DeliveryTracker();
      tracker.checkReceived('sender1', 1);
      tracker.noteDeliveryFailure();
      // The next in-order message must still read as expected 2, not a gap.
      expect(tracker.checkReceived('sender1', 2)).toEqual({ gap: false, expected: 2 });
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      const tracker = new DeliveryTracker();
      tracker.nextSequence();
      tracker.nextSequence();
      tracker.checkReceived('sender1', 1);
      tracker.checkReceived('sender1', 3); // gap

      tracker.reset();

      expect(tracker.nextSequence()).toBe(1); // counter reset
      expect(tracker.hasGap()).toBe(false); // gap cleared
      expect(tracker.checkReceived('sender1', 1)).toEqual({ gap: false, expected: 1 }); // tracking reset
    });
  });
});
