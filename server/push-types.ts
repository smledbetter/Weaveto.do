/**
 * Push subscription types for weaveto.do relay server.
 * These messages flow over the existing WebSocket connection to register
 * and unregister Web Push subscriptions server-side.
 */

/** Standard Web Push subscription from PushManager.subscribe() */
export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string; // Base64url-encoded
    auth: string; // Base64url-encoded
  };
}

/** Message from client to relay to register push subscription */
export interface PushSubscribeMessage {
  type: "push_subscribe";
  subscription: PushSubscriptionData;
  roomId: string;
  identityKey: string;
}

/** Message from client to relay to unsubscribe */
export interface PushUnsubscribeMessage {
  type: "push_unsubscribe";
  roomId: string;
  identityKey: string;
}
