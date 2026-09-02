/**
 * Replaying task events that were made offline.
 *
 * When a room reconnects, anything created while the connection was down has
 * to be sent. That sounds like a loop, and it was one, living inside a
 * `setTimeout` inside a handler inside `joinRoom()`. Being unreachable from a
 * test is how it kept a bug.
 *
 * `RoomSession.sendTaskEvent` throws when the socket is not open, and the
 * socket being flaky is the whole premise of a replay. The old loop emptied
 * the queue before sending, so a throw part-way through lost every remaining
 * event from memory, left the `pendingSync` flag cleared on events that were
 * never sent, and never reached the line that clears the spinner. The room sat
 * on "Syncing..." forever while the person believed their work had gone.
 *
 * The durable queue in IndexedDB did survive, because the code that clears it
 * was also never reached. So the data came back on the next page load. It was
 * a fright rather than a loss, and only by accident.
 *
 * The rule this encodes: an event leaves the queue when it has been sent, and
 * not before.
 */

import type { TaskEvent } from "./types";

export interface ReplayOutcome {
  /** Events that were handed to the transport without throwing. */
  sent: TaskEvent[];
  /** Events still owed, in their original order. Keep these queued. */
  remaining: TaskEvent[];
  /**
   * Whether everything was sent. Only then is it safe to drop the durable
   * copy, which is why this is separate from `remaining.length === 0`: a
   * caller that ignores it and clears anyway is making a visible mistake.
   */
  complete: boolean;
}

/**
 * Send each event, stopping at the first failure.
 *
 * Stopping rather than skipping is deliberate. These are ordered events
 * against a shared task log, and a transport that just refused one is not
 * going to accept the next. Pressing on would reorder the log for every other
 * member to save a round trip nobody asked for.
 *
 * `send` is a parameter rather than a session so this can be tested against a
 * transport that fails on the third of five, which is the case that mattered
 * and the one no test could reach before.
 */
export function replayTaskEvents(
  events: readonly TaskEvent[],
  send: (event: TaskEvent) => void,
): ReplayOutcome {
  const sent: TaskEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    try {
      send(event);
    } catch {
      // The socket went down again mid-replay. Everything from here on is
      // still owed, including this one.
      return {
        sent,
        remaining: events.slice(i) as TaskEvent[],
        complete: false,
      };
    }
    // Only now is it no longer pending. Clearing this before the send meant an
    // event that never left showed in the UI as though it had.
    if (event.task) event.task.pendingSync = false;
    sent.push(event);
  }

  return { sent, remaining: [], complete: true };
}
