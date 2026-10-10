import { NotificationType } from '@prisma/client';

const MAX_SUBJECT_LENGTH = 100;

/** Shortens text to `max` characters, ending in an ellipsis if it was cut. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * WHAT: Writes the human-readable sentence stored with a notification.
 *
 * Pure (no database, no clock), so every wording is one trivial test.
 *
 * WHY the sentence is built and STORED on the server instead of assembled by
 * the browser from ids: the notification is a record of how things stood when
 * it happened (see the `Notification` model). It also keeps wording in one
 * place, and lets future channels - email, push - reuse it unchanged.
 *
 * The subject (a task title or project name) is user-written text of up to 200
 * characters, so it is shortened to keep the whole message within the
 * database column's limit.
 */
export function buildNotificationMessage(
  type: NotificationType,
  actorName: string | null,
  subject: string,
): string {
  const actor = actorName ?? 'Someone';
  const what = truncate(subject, MAX_SUBJECT_LENGTH);

  switch (type) {
    case NotificationType.TASK_ASSIGNED:
      return `${actor} assigned you "${what}"`;
    case NotificationType.COMMENT_ADDED:
      return `${actor} commented on "${what}"`;
    case NotificationType.ADDED_TO_PROJECT:
      return `${actor} added you to the project "${what}"`;
  }
}
