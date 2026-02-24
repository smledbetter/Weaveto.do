/**
 * Message delivery tracker.
 *
 * Maintains per-sender sequence counters so the local client can detect gaps
 * in the message stream (e.g. dropped or reordered messages).  Each outgoing
 * message carries a monotonically increasing sequence number; each incoming
 * message is checked against the next expected counter for that sender.
 *
 * The tracker is reset on reconnect — sequence numbers restart from 1 after
 * every fresh WebSocket connection.
 */

export class DeliveryTracker {
  /** Monotonic counter for messages sent by the local peer. */
  private localSequence = 0;

  /**
   * Stores the highest sequence number seen from each remote sender.
   * The next expected value is always `stored + 1`.
   */
  private expectedSequences = new Map<string, number>();

  /** Set to true the first time a gap is detected; cleared by reset(). */
  private gapDetected = false;

  /**
   * Return the next outgoing sequence number and advance the local counter.
   * Sequence numbers start at 1 (first call returns 1).
   */
  nextSequence(): number {
    return ++this.localSequence;
  }

  /**
   * Check an incoming message sequence number against what is expected from
   * the given sender.
   *
   * A gap is reported when `sequence > expected`, meaning at least one
   * message was skipped.  Out-of-order or duplicate delivery (sequence <
   * expected) is noted but does not set the gap flag — the caller can inspect
   * `expected` to decide how to handle it.
   *
   * The internal high-water mark is advanced to whichever is larger:
   * `sequence` or `expected`, so future calls remain coherent even when
   * messages arrive out of order.
   *
   * @param senderKey - The sender's Curve25519 identity key (unique per peer).
   * @param sequence  - The sequence number carried by the received message.
   * @returns `{ gap, expected }` — whether a gap was detected and the
   *          sequence number that was expected.
   */
  checkReceived(
    senderKey: string,
    sequence: number,
  ): { gap: boolean; expected: number } {
    const expected = (this.expectedSequences.get(senderKey) ?? 0) + 1;
    const gap = sequence > expected;

    if (gap) {
      this.gapDetected = true;
    }

    // Advance the high-water mark so that future checks are based on the
    // largest sequence seen, not the expected value (handles out-of-order).
    this.expectedSequences.set(senderKey, Math.max(sequence, expected));

    return { gap, expected };
  }

  /**
   * Returns true if any gap has been detected since the last reset().
   * Useful for surfacing a "possible missed messages" indicator in the UI.
   */
  hasGap(): boolean {
    return this.gapDetected;
  }

  /**
   * Clear all tracking state.  Call this whenever the WebSocket reconnects
   * and sequence numbers restart from 1.
   */
  reset(): void {
    this.localSequence = 0;
    this.expectedSequences.clear();
    this.gapDetected = false;
  }
}
