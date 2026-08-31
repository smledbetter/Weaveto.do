// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PROFILES } from "../../tools/loadtest/profiles";
import { RELAY_LIMITS } from "../../tools/loadtest/protocol";

/**
 * Every profile must generate load the relay will actually accept.
 *
 * A profile that exceeds a cap does not measure the thing it names. The relay
 * disconnects the offending senders, the run carries less load than intended,
 * and it reports a *better* number than the honest one. A stale constant that
 * produces a flattering result is worse than one that produces a failure,
 * because nothing about the output looks wrong.
 *
 * This happened: `intervalMs` was hardcoded at 100, which is 10 messages per
 * second. Legal against MSG_RATE_LIMIT of 30, illegal against 5. The first
 * fan-out run after the cap cut showed roughly half the connections surviving
 * and a memory high-water mark 2.6x better than the baseline, and the
 * improvement was partly the senders being kicked off.
 */

describe("every profile stays inside the relay's caps", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    describe(name, () => {
      it("sends slower than the budget that binds probe traffic", () => {
        // Probes are all `encrypted`, so BROADCAST_RATE_LIMIT is what closes
        // them, not the looser global limit. A sender at exactly the cap is
        // already over it once its timing jitters.
        const perSecond = 1000 / profile.probe.intervalMs;
        expect(perSecond).toBeLessThan(RELAY_LIMITS.BROADCAST_RATE_LIMIT);
      });

      it("does not put more clients in a room than the relay allows", () => {
        expect(profile.clientsPerRoom).toBeLessThanOrEqual(
          RELAY_LIMITS.MAX_CLIENTS_PER_ROOM,
        );
      });

      it("does not ask more members to send than the room holds", () => {
        expect(profile.probe.sendersPerRoom).toBeLessThanOrEqual(
          profile.clientsPerRoom,
        );
      });

      it("stays under the message size limit", () => {
        expect(profile.probe.ciphertextBytes).toBeLessThanOrEqual(
          RELAY_LIMITS.MAX_CIPHERTEXT_LENGTH,
        );
      });
    });
  }

  it("fills a room in the fan-out profile, which is its whole purpose", () => {
    // If this drifts below the cap the profile stops measuring the worst case
    // the caps permit, which is the only reason it exists.
    expect(PROFILES.fanout.clientsPerRoom).toBe(
      RELAY_LIMITS.MAX_CLIENTS_PER_ROOM,
    );
  });
});
