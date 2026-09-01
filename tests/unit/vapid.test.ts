// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initVapid, getVapidPublicKey, sendPushNotification } from '../../server/vapid';
import type { PushSubscriptionData } from '../../server/push-types';

// Reset module-level VAPID state between tests by re-importing with cleared env.
// initVapid() re-assigns the module-level `vapidKeys` on each call, which is
// sufficient — calling it in beforeEach ensures a consistent baseline.

describe('VAPID', () => {
  beforeEach(() => {
    // Clear any VAPID env vars so tests use ephemeral key generation
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    // Ensure keys are initialised for tests that need them
    initVapid();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // initVapid
  // -------------------------------------------------------------------------

  describe('initVapid', () => {
    it('generates a non-empty public key', () => {
      const keys = initVapid();
      expect(keys.publicKey).toBeTruthy();
      expect(typeof keys.publicKey).toBe('string');
    });

    it('generates a non-empty private key', () => {
      const keys = initVapid();
      expect(keys.privateKey).toBeTruthy();
      expect(typeof keys.privateKey).toBe('string');
    });

    it('public key is base64url-encoded (no + or / chars)', () => {
      const keys = initVapid();
      expect(keys.publicKey).not.toContain('+');
      expect(keys.publicKey).not.toContain('/');
    });

    it('public key decodes to 65 bytes (uncompressed P-256 point: 04 || x || y)', () => {
      const keys = initVapid();
      // base64url → Buffer
      const raw = Buffer.from(keys.publicKey, 'base64url');
      expect(raw.length).toBe(65);
    });

    it('public key starts with 0x04 (uncompressed point prefix)', () => {
      const keys = initVapid();
      const raw = Buffer.from(keys.publicKey, 'base64url');
      expect(raw[0]).toBe(0x04);
    });

    it('private key decodes to 32 bytes (P-256 scalar)', () => {
      const keys = initVapid();
      const raw = Buffer.from(keys.privateKey, 'base64url');
      expect(raw.length).toBe(32);
    });

    it('is idempotent when env vars are set — calling twice returns the same keys', () => {
      // initVapid() always re-derives from env vars when they are present,
      // so two consecutive calls with the same env vars must return identical keys.
      process.env.VAPID_PUBLIC_KEY = 'fixed-public-key';
      process.env.VAPID_PRIVATE_KEY = 'fixed-private-key';
      const first = initVapid();
      const second = initVapid();
      expect(second.publicKey).toBe(first.publicKey);
      expect(second.privateKey).toBe(first.privateKey);
    });

    it('generates fresh ephemeral keys on each call when no env vars are set', () => {
      // In dev mode (no env vars) each initVapid() call generates a new key pair.
      // This tests that the generation path is exercised, not that keys are stable.
      const first = initVapid();
      const second = initVapid();
      // Both calls must produce structurally valid keys; they need not match.
      expect(first.publicKey.length).toBeGreaterThan(80);
      expect(second.publicKey.length).toBeGreaterThan(80);
    });

    it('uses env var VAPID_PUBLIC_KEY when set', () => {
      // Provide a syntactically valid base64url string (doesn't need to be a real key
      // for initVapid — it just stores whatever the env var contains).
      process.env.VAPID_PUBLIC_KEY = 'env-public-key';
      process.env.VAPID_PRIVATE_KEY = 'env-private-key';
      const keys = initVapid();
      expect(keys.publicKey).toBe('env-public-key');
      expect(keys.privateKey).toBe('env-private-key');
    });
  });

  // -------------------------------------------------------------------------
  // getVapidPublicKey
  // -------------------------------------------------------------------------

  describe('getVapidPublicKey', () => {
    it('returns a non-empty string', () => {
      const key = getVapidPublicKey();
      expect(key).toBeTruthy();
      expect(typeof key).toBe('string');
    });

    it('is base64url — contains no + or / characters', () => {
      const key = getVapidPublicKey();
      expect(key).not.toContain('+');
      expect(key).not.toContain('/');
    });

    it('matches the public key returned by initVapid', () => {
      const keys = initVapid();
      expect(getVapidPublicKey()).toBe(keys.publicKey);
    });
  });

  // -------------------------------------------------------------------------
  // sendPushNotification
  // -------------------------------------------------------------------------

  describe('sendPushNotification', () => {
    // These used to mock global.fetch. sendPushNotification now uses node:https
    // so it can pin the connection to an address it has checked, and the fetch
    // mocks stopped intercepting anything. The tests did not fail loudly: they
    // made real requests to fcm.googleapis.com, which answered 404 for a fake
    // subscription, and every status assertion came back 'gone'.
    //
    // They run against a real HTTP server on this host instead, reached by
    // replacing the connection the agent makes. That exercises the actual
    // request construction rather than a mock's memory of it, and nothing
    // leaves the machine.
    const mockSubscription: PushSubscriptionData = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test123',
      keys: {
        p256dh: 'BNZxFg2u3YF-n0IJgLp2b8FACFb2yEkCmF8BjqWvWKUAGHiSjDE0TjSBhGEj_rqyqO2LjxJ1DOaGqSE1zsYZWQ',
        auth: 'Q2BoAZzCKExn-1t-IYQP_A',
      },
    };

    interface Received {
      method: string;
      url: string;
      headers: Record<string, string | string[] | undefined>;
    }

    let server: import('node:http').Server;
    let stubPort = 0;
    let received: Received[];
    let status = 201;
    let restore: (() => void) | null = null;

    beforeEach(async () => {
      const http = await import('node:http');
      const net = await import('node:net');
      const https = await import('node:https');

      received = [];
      status = 201;
      server = http.createServer((req, res) => {
        received.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
        });
        res.writeHead(status).end();
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      stubPort = (server.address() as import('node:net').AddressInfo).port;

      // The global agent pools sockets. Each test gets a fresh stub on a new
      // port, so a socket left over from the previous one points at a server
      // that is already closed and the request fails for the wrong reason.
      https.globalAgent.destroy();

      const agent = https.globalAgent as unknown as { createConnection: unknown };
      const original = agent.createConnection;
      agent.createConnection = (_o: unknown, cb: unknown) =>
        net.connect(stubPort, '127.0.0.1', cb as () => void);
      restore = () => {
        agent.createConnection = original;
      };
    });

    afterEach(async () => {
      const https = await import('node:https');
      https.globalAgent.destroy();
      restore?.();
      restore = null;
      await new Promise<void>((r) => server.close(() => r()));
    });

    /** The Authorization header the relay actually put on the wire. */
    const authHeader = (): string => String(received[0].headers.authorization);

    it('returns "ok" when the push service responds with 201', async () => {
      status = 201;
      expect(await sendPushNotification(mockSubscription, '')).toBe('ok');
    });

    it('returns "gone" when the push service responds with 410', async () => {
      status = 410;
      expect(await sendPushNotification(mockSubscription, '')).toBe('gone');
    });

    it('returns "error" for any non-201/410 status code', async () => {
      status = 429;
      expect(await sendPushNotification(mockSubscription, '')).toBe('error');
    });

    it('returns "error" when the connection fails', async () => {
      // Close the stub but keep pointing at its port, so the connection is
      // refused on loopback. Restoring the real connection instead would send
      // this test to the internet, which is what the old fetch mocks ended up
      // doing once they stopped intercepting anything.
      await new Promise<void>((r) => server.close(() => r()));
      expect(await sendPushNotification(mockSubscription, '')).toBe('error');
      // Reopen so afterEach's close has something to close.
      const http = await import('node:http');
      server = http.createServer((_q, res) => res.writeHead(201).end());
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    });

    it('refuses an endpoint it must never POST to, without connecting', async () => {
      // The guard runs before anything is sent, so nothing reaches the stub.
      const result = await sendPushNotification(
        { ...mockSubscription, endpoint: 'http://fcm.googleapis.com/fcm/send/x' },
        '',
      );
      expect(result).toBe('error');
      expect(received).toHaveLength(0);
    });

    it('sends a POST to the subscription path', async () => {
      await sendPushNotification(mockSubscription, '');
      expect(received).toHaveLength(1);
      expect(received[0].method).toBe('POST');
      expect(received[0].url).toBe('/fcm/send/test123');
    });

    it('includes a vapid Authorization header with correct format', async () => {
      await sendPushNotification(mockSubscription, '');
      // RFC 8292 section 4: vapid t=<JWT>, k=<public-key>
      expect(authHeader()).toMatch(/^vapid t=.+, k=.+$/);
    });

    it('Authorization header k= value matches the VAPID public key', async () => {
      await sendPushNotification(mockSubscription, '');
      expect(authHeader()).toContain(`k=${getVapidPublicKey()}`);
    });

    it('sends Content-Length: 0 for a ping-only (empty payload) push', async () => {
      await sendPushNotification(mockSubscription, '');
      expect(received[0].headers['content-length']).toBe('0');
    });

    it('sets TTL header to 86400', async () => {
      await sendPushNotification(mockSubscription, '');
      expect(received[0].headers['ttl']).toBe('86400');
    });

    it('JWT token contains three dot-separated base64url segments', async () => {
      await sendPushNotification(mockSubscription, '');
      const match = authHeader().match(/^vapid t=([^,]+), k=.+$/);
      expect(match).not.toBeNull();

      const parts = match![1].split('.');
      expect(parts.length).toBe(3);
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0);
        expect(part).not.toContain('+');
        expect(part).not.toContain('/');
      }
    });

    it('JWT header decodes to { typ: "JWT", alg: "ES256" }', async () => {
      await sendPushNotification(mockSubscription, '');
      const jwt = authHeader().match(/t=([^,]+)/)![1];
      const header = JSON.parse(
        Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8'),
      );
      expect(header.typ).toBe('JWT');
      expect(header.alg).toBe('ES256');
    });

    it('JWT payload contains sub, aud, and exp fields', async () => {
      await sendPushNotification(mockSubscription, '');
      const jwt = authHeader().match(/t=([^,]+)/)![1];
      const payload = JSON.parse(
        Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'),
      );
      expect(payload.sub).toBeTruthy();
      // The audience is the endpoint's origin, not the full URL.
      expect(payload.aud).toBe('https://fcm.googleapis.com');
      expect(typeof payload.exp).toBe('number');
    });
  });
});
