/** Reason a room was destroyed */
export type DestroyReason = 'manual' | 'auto_delete' | 'ephemeral';

/** Server message when room is destroyed */
export interface RoomDestroyedMessage {
  type: 'room_destroyed';
  reason: DestroyReason;
}

/** Server response when purge request is unauthorized */
export interface PurgeUnauthorizedMessage {
  type: 'purge_unauthorized';
}

/** Auto-delete countdown state (stored in sessionStorage) */
export interface AutoDeleteState {
  expiresAt: number;
  cancelled: boolean;
}

/** Key for auto-delete sessionStorage: `weave-auto-delete:${roomId}` */
export function autoDeleteKey(roomId: string): string {
  return `weave-auto-delete:${roomId}`;
}
