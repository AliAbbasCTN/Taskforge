const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * WHAT: "just now", "5 min ago", "3 h ago", "2 d ago" - and a plain date once
 * it is a week old (nobody reads "37 d ago").
 *
 * Takes `now` as a parameter so it is a PURE function: the same inputs always
 * give the same answer, which is what makes it testable. (Calling `Date.now()`
 * inside would make every test depend on the clock.)
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (elapsed < MINUTE) {
    return 'just now'; // also covers small clock differences (negative values)
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)} min ago`;
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)} h ago`;
  }
  if (elapsed < 7 * DAY) {
    return `${Math.floor(elapsed / DAY)} d ago`;
  }
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
