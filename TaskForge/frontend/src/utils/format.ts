/**
 * Formats a due date like "Dec 31".
 *
 * WHY `timeZone: 'UTC'`: the backend stores a due date as a moment in time,
 * and `"2026-12-31"` arrives as midnight UTC. Formatting it in the viewer's
 * local zone would show "Dec 30" for anyone west of UTC. A due DATE is a
 * calendar day, not an instant, so we format it in the zone it was stored in.
 */
export function formatDueDate(iso: string, locale?: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** True if the calendar day of `iso` is before today's UTC calendar day. */
export function isOverdue(iso: string, now: Date = new Date()): boolean {
  const startOfTodayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return new Date(iso).getTime() < startOfTodayUtc;
}

/** First letter of a name, for the small avatar circle. */
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}
