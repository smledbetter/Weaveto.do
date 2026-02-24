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
    // A realistic-looking but fake subscription.  The test mock intercepts fetch
    // before any real HTTP happens, so the values only need to be structurally valid.
    const mockSubscription: PushSubscriptionData = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test123',
      keys: {
        p256dh: 'BNZxFg2u3YF-n0IJgLp2b8FACFb2yEkCmF8BjqWvWKUAGHiSjDE0TjSBhGEj_rqyqO2LjxJ1DOaGqSE1zsYZWQ',
        auth: 'Q2BoAZzCKExn-1t-IYQP_A',
      },
    };

    it('returns "ok" when the push service responds with 201', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 201 });
      const result = await sendPushNotification(mockSubscription, '');
      expect(result).toBe('ok');
    });

    it('returns "gone" when the push service responds with 410', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 410 });
      const result = await sendPushNotification(mockSubscription, '');
      expect(result).toBe('gone');
    });

    it('returns "error" for any non-201/410 status code', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 429 });
      const result = await sendPushNotification(mockSubscription, '');
      expect(result).toBe('error');
    });

    it('returns "error" on network failure (fetch throws)', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const result = await sendPushNotification(mockSubscription, '');
      expect(result).toBe('error');
    });

    it('sends a POST request to the subscription endpoint', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 201 });
      await sendPushNotification(mockSubscription, '');

      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(mockSubscription.endpoint);
      expect(options.method).toBe('POST');
    });

    it('includes a vapid Authorization header with correct format', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 201 });
      await sendPushNotification(mockSubscription, '');

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      // RFC 8292 §4: vapid t=<JWT>, k=<public-key>
      expect(options.headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    });

    it('Authorization header k= value matches the VAPID public key', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 201 });
      await sendPushNotification(mockSubscription, '');

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const pubKey = getVapidPublicKey();
      expect(options.headers.Authorization).toContain(`k=${pubKey}`);
    });

    it('sends Content-Length: 0 for a ping-only (empty payload) push', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 201 });
      await sendPushNotification(mockSubscription, '');

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(options.headers['Content-Length']).toBe('0');
    });

    it('sets TTL header to 86400', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 201 });
      await sendPushNotification(mockSubscription, '');

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(options.headers['TTL']).toBe('86400');
    });

    it('JWT token contains three dot-separated base64url segments', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 201 });
      await sendPushNotification(mockSubscription, '');

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      // Authorization: vapid t=<jwt>, k=<key>
      const match = (options.headers.Authorization as string).match(/^vapid t=([^,]+), k=.+$/);
      expect(match).not.toBeNull();

      const jwt = match![1];
      const parts = jwt.split('.');
      expect(parts.length).toBe(3);

      // Each part must be non-empty base64url
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0);
        expect(part).not.toContain('+');
        expect(part).not.toContain('/');
      }
    });

    it('JWT header decodes to { typ: "JWT", alg: "ES256" }', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 201 });
      await sendPushNotification(mockSubscription, '');

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const jwt = (options.headers.Authorization as string).match(/t=([^,]+)/)![1];
      const headerJson = Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8');
      const header = JSON.parse(headerJson);

      expect(header.typ).toBe('JWT');
      expect(header.alg).toBe('ES256');
    });

    it('JWT payload contains sub, aud, and exp fields', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 201 });
      await sendPushNotification(mockSubscription, '');

      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const jwt = (options.headers.Authorization as string).match(/t=([^,]+)/)![1];
      const payloadJson = Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson);

      expect(payload.sub).toBeTruthy();
      expect(payload.aud).toBe('https://fcm.googleapis.com');
      expect(typeof payload.exp).toBe('number');
    });
  });
});
