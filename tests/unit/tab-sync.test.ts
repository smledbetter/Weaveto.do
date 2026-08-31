import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TabSync } from "../../src/lib/room/tab-sync";

// ---------------------------------------------------------------------------
// BroadcastChannel mock
// ---------------------------------------------------------------------------
// jsdom does not implement BroadcastChannel, so we provide a minimal
// simulation where every instance shares the same message bus.
// ---------------------------------------------------------------------------

class MockBroadcastChannel {
  name: string;
  private listeners: Array<(ev: MessageEvent) => void> = [];

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  addEventListener(type: string, listener: (ev: MessageEvent) => void): void {
    if (type === "message") this.listeners.push(listener);
  }

  removeEventListener(
    type: string,
    listener: (ev: MessageEvent) => void,
  ): void {
    if (type === "message") {
      this.listeners = this.listeners.filter((l) => l !== listener);
    }
  }

  postMessage(data: unknown): void {
    MockBroadcastChannel.lastMessage = data;
    // Deliver to every OTHER registered instance.
    for (const instance of MockBroadcastChannel.instances) {
      if (instance !== this) {
        const event = new MessageEvent("message", { data });
        for (const listener of instance.listeners) {
          listener(event);
        }
      }
    }
  }

  close(): void {
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter(
      (i) => i !== this,
    );
  }

  static instances: MockBroadcastChannel[] = [];
  static lastMessage: unknown = null;

  static reset(): void {
    this.instances = [];
    this.lastMessage = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inject a message directly into a TabSync instance (simulates receiving from
 * another tab) by dispatching through the channel the instance registered on.
 * This reaches in to the first registered MockBroadcastChannel for roomId. */
function deliverTo(channel: MockBroadcastChannel, data: unknown): void {
  const event = new MessageEvent("message", { data });
  // Access the internal listeners array via the mock instance.
  const listeners = (channel as any).listeners as Array<
    (ev: MessageEvent) => void
  >;
  for (const l of listeners) {
    l(event);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TabSync", () => {
  beforeEach(() => {
    MockBroadcastChannel.reset();
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── Construction ──────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("creates a BroadcastChannel named 'weave-tab-sync'", () => {
      new TabSync("room-abc");
      expect(MockBroadcastChannel.instances).toHaveLength(1);
      expect(MockBroadcastChannel.instances[0].name).toBe("weave-tab-sync");
    });

    it("broadcasts tab-register on construction", () => {
      new TabSync("room-abc");
      expect(MockBroadcastChannel.lastMessage).toMatchObject({
        type: "tab-register",
        roomId: "room-abc",
      });
    });

    it("assigns a unique tabId per instance", () => {
      const a = new TabSync("room-abc");
      const b = new TabSync("room-abc");
      const aMsg = (a as any).tabId as string;
      const bMsg = (b as any).tabId as string;
      expect(aMsg).toBeTruthy();
      expect(bMsg).toBeTruthy();
      expect(aMsg).not.toBe(bMsg);
    });

    it("does not create a channel when BroadcastChannel is undefined", () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      const sync = new TabSync("room-xyz");
      expect((sync as any).channel).toBeNull();
      expect(MockBroadcastChannel.instances).toHaveLength(0);
    });
  });

  // ── broadcastLock ─────────────────────────────────────────────────────────

  describe("broadcastLock", () => {
    it("posts a pin-locked message with its own tabId", () => {
      const sync = new TabSync("room-abc");
      MockBroadcastChannel.lastMessage = null; // clear the register message

      sync.broadcastLock();

      expect(MockBroadcastChannel.lastMessage).toMatchObject({
        type: "pin-locked",
        tabId: (sync as any).tabId,
      });
    });
  });

  // ── onLock callback ───────────────────────────────────────────────────────

  describe("onLock callback", () => {
    it("invokes callback when pin-locked arrives from a different tabId", () => {
      const sync = new TabSync("room-abc");
      const channel = MockBroadcastChannel.instances[0];
      const onLock = vi.fn();
      sync.onLock(onLock);

      deliverTo(channel, { type: "pin-locked", tabId: "other-tab-id" });

      expect(onLock).toHaveBeenCalledOnce();
    });

    it("does NOT invoke callback for self-originated pin-locked message", () => {
      const sync = new TabSync("room-abc");
      const channel = MockBroadcastChannel.instances[0];
      const onLock = vi.fn();
      sync.onLock(onLock);

      // Deliver a message bearing the same tabId that sync owns.
      deliverTo(channel, {
        type: "pin-locked",
        tabId: (sync as any).tabId,
      });

      expect(onLock).not.toHaveBeenCalled();
    });

    it("does not crash when no callback is registered", () => {
      const sync = new TabSync("room-abc");
      const channel = MockBroadcastChannel.instances[0];

      expect(() => {
        deliverTo(channel, { type: "pin-locked", tabId: "other-tab" });
      }).not.toThrow();
    });
  });

  // ── tab-ping / tab-pong ───────────────────────────────────────────────────

  describe("tab-ping / tab-pong", () => {
    it("responds to tab-ping with tab-pong bearing its own tabId", () => {
      const responder = new TabSync("room-abc");
      const responderChannel = MockBroadcastChannel.instances[0];
      MockBroadcastChannel.lastMessage = null;

      deliverTo(responderChannel, {
        type: "tab-ping",
        requestId: "req-001",
      });

      expect(MockBroadcastChannel.lastMessage).toMatchObject({
        type: "tab-pong",
        requestId: "req-001",
        tabId: (responder as any).tabId,
      });
    });

    it("ignores tab-ping bearing its own tabId (self-message guard)", () => {
      const sync = new TabSync("room-abc");
      const channel = MockBroadcastChannel.instances[0];
      MockBroadcastChannel.lastMessage = null;

      // A ping that accidentally carries our own tabId should be dropped.
      deliverTo(channel, {
        type: "tab-ping",
        requestId: "req-self",
        tabId: (sync as any).tabId,
      });

      // No pong should have been posted.
      expect(MockBroadcastChannel.lastMessage).toBeNull();
    });
  });

  // ── getActiveTabCount ─────────────────────────────────────────────────────

  describe("getActiveTabCount", () => {
    it("returns 1 when BroadcastChannel is unavailable", async () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      const sync = new TabSync("room-abc");

      const count = await sync.getActiveTabCount();

      expect(count).toBe(1);
    });

    it("counts self plus responding tabs after 200 ms timeout", async () => {
      // Two tabs: pinger and two responders.
      const pinger = new TabSync("room-abc");
      const responderA = new TabSync("room-abc");
      const responderB = new TabSync("room-abc");

      // Each TabSync registered a channel; pinger is instances[0].
      // responderA is instances[1], responderB is instances[2].

      const countPromise = pinger.getActiveTabCount();

      // The ping was broadcast automatically; responderA and responderB
      // receive it via MockBroadcastChannel.postMessage (cross-instance
      // delivery in our mock). Advance timers past the 200 ms window.
      vi.advanceTimersByTime(200);

      const count = await countPromise;

      // pinger counts itself (1) plus the two pong responses.
      expect(count).toBe(3);

      responderA.destroy();
      responderB.destroy();
    });

    it("includes only self when no other tabs respond within 200 ms", async () => {
      const sync = new TabSync("room-abc");
      const countPromise = sync.getActiveTabCount();

      vi.advanceTimersByTime(200);
      const count = await countPromise;

      // Only this tab responded (no other instances).
      expect(count).toBe(1);
    });
  });

  // ── destroy ───────────────────────────────────────────────────────────────

  describe("destroy", () => {
    it("broadcasts tab-deregister before closing the channel", () => {
      const sync = new TabSync("room-abc");
      MockBroadcastChannel.lastMessage = null;

      sync.destroy();

      expect(MockBroadcastChannel.lastMessage).toMatchObject({
        type: "tab-deregister",
        tabId: (sync as any).tabId,
      });
    });

    it("removes the instance from the channel registry after close", () => {
      const sync = new TabSync("room-abc");
      expect(MockBroadcastChannel.instances).toHaveLength(1);

      sync.destroy();

      // close() removes itself from instances in the mock.
      expect(MockBroadcastChannel.instances).toHaveLength(0);
    });

    it("nulls out the internal channel reference", () => {
      const sync = new TabSync("room-abc");
      sync.destroy();

      expect((sync as any).channel).toBeNull();
    });

    it("is a no-op when BroadcastChannel was unavailable", () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      const sync = new TabSync("room-abc");

      // Should not throw.
      expect(() => sync.destroy()).not.toThrow();
    });

    it("clears the lockCallback", () => {
      const sync = new TabSync("room-abc");
      sync.onLock(() => {});
      sync.destroy();

      expect((sync as any).lockCallback).toBeNull();
    });

    it("clears pending pong listeners", () => {
      const sync = new TabSync("room-abc");
      // Seed a fake pong listener to verify it is cleaned up.
      (sync as any).pongListeners.set("req-x", () => {});
      sync.destroy();

      expect((sync as any).pongListeners.size).toBe(0);
    });
  });

  // ── message guard: malformed / unknown messages ───────────────────────────

  describe("handleMessage guards", () => {
    it("ignores null data", () => {
      const sync = new TabSync("room-abc");
      const channel = MockBroadcastChannel.instances[0];

      expect(() => deliverTo(channel, null)).not.toThrow();
    });

    it("ignores non-object data", () => {
      const sync = new TabSync("room-abc");
      const channel = MockBroadcastChannel.instances[0];

      expect(() => deliverTo(channel, "raw string")).not.toThrow();
    });

    it("ignores messages without a 'type' field", () => {
      const sync = new TabSync("room-abc");
      const channel = MockBroadcastChannel.instances[0];

      expect(() => deliverTo(channel, { tabId: "x", data: 42 })).not.toThrow();
    });

    it("ignores unknown message types", () => {
      const sync = new TabSync("room-abc");
      const channel = MockBroadcastChannel.instances[0];

      expect(() =>
        deliverTo(channel, { type: "unknown-future-type", tabId: "x" }),
      ).not.toThrow();
    });
  });
});
