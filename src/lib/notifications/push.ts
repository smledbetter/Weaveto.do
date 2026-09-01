/**
 * Push Subscription Manager — Web Push API client helpers.
 *
 * Stores push subscription details in IndexedDB for recovery across page
 * reloads. Uses a separate database from weave-notification-prefs to avoid
 * coupling unrelated concerns.
 *
 * Security: No task content, room names, or user data stored here.
 * Only roomId, push endpoint URL, and ECDH keys (p256dh + auth).
 */

const PUSH_DB_NAME = 'weave-push-subscriptions';
const PUSH_STORE_NAME = 'subscriptions';
const PUSH_DB_VERSION = 1;

export interface StoredPushSubscription {
  roomId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Open (or create) the push subscriptions IndexedDB.
 * Object store keyed by roomId.
 */
export function initPushDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUSH_DB_NAME, PUSH_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(PUSH_STORE_NAME)) {
        db.createObjectStore(PUSH_STORE_NAME, { keyPath: 'roomId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persist a push subscription for a room.
 * Overwrites any existing record for the same roomId.
 */
export async function storePushSubscription(
  db: IDBDatabase,
  roomId: string,
  subscription: PushSubscription,
): Promise<void> {
  const json = subscription.toJSON();
  const record: StoredPushSubscription = {
    roomId,
    endpoint: json.endpoint!,
    p256dh: json.keys!['p256dh'],
    auth: json.keys!['auth'],
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUSH_STORE_NAME, 'readwrite');
    tx.objectStore(PUSH_STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Load the stored push subscription for a room.
 * Returns null if no record exists.
 */
export async function loadPushSubscription(
  db: IDBDatabase,
  roomId: string,
): Promise<StoredPushSubscription | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUSH_STORE_NAME, 'readonly');
    const request = tx.objectStore(PUSH_STORE_NAME).get(roomId);
    request.onsuccess = () => resolve((request.result as StoredPushSubscription) ?? null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove the stored push subscription for a room.
 * Called on room leave / cleanup.
 */
export async function clearPushSubscription(
  db: IDBDatabase,
  roomId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUSH_STORE_NAME, 'readwrite');
    tx.objectStore(PUSH_STORE_NAME).delete(roomId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Returns true if the current browser supports Web Push.
 * Checks for both PushManager and service worker registration support.
 */
export function isPushSupported(): boolean {
  return 'PushManager' in window && 'serviceWorker' in navigator;
}

/**
 * Subscribe to push notifications using the provided VAPID public key.
 * Waits for the service worker to be ready before subscribing.
 * Returns null on failure (permission denied, SW unavailable, etc.).
 */
/**
 * How many rooms still have push turned on.
 *
 * A browser has one push subscription per service worker registration, so
 * every room shares the same endpoint. Unsubscribing is therefore a
 * browser-wide act, and doing it because one room turned notifications off
 * silently ends them everywhere else. Callers check this first.
 */
export async function countPushSubscriptions(db: IDBDatabase): Promise<number> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(PUSH_STORE_NAME, 'readonly');
      const request = tx.objectStore(PUSH_STORE_NAME).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription | null> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
    });
    return subscription;
  } catch {
    return null;
  }
}

/**
 * Unsubscribe from push notifications.
 *
 * This ends the browser's single subscription, so it ends push for every room,
 * not just the one asking. Only call it once no room has notifications on. See
 * countPushSubscriptions.
 *
 * Returns true if successfully unsubscribed or no subscription existed.
 * Returns false on error.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      return await subscription.unsubscribe();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a base64url-encoded VAPID public key to a Uint8Array suitable
 * for use as the applicationServerKey in pushManager.subscribe().
 *
 * Handles the base64url → base64 conversion (- → +, _ → /) and padding.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
