/**
 * Notification preferences and message types for local notifications.
 *
 * Security: No task content, room names, or user data stored here.
 * Only room identity (roomId), enable flag, and time strings.
 */

export interface NotificationPrefs {
  roomId: string;
  enabled: boolean;
  quietStart: string; // "HH:MM" format, e.g. "22:00"
  quietEnd: string;   // "HH:MM" format, e.g. "08:00"
}

export const DEFAULT_QUIET_START = '22:00';
export const DEFAULT_QUIET_END = '08:00';

export interface NotifyMessage {
  type: 'NOTIFY';
  title: string;
  body: string;
  tag: string;
  roomId: string;
}

export interface UpdatePrefsMessage {
  type: 'UPDATE_NOTIFICATION_PREFS';
  prefs: NotificationPrefs;
}
