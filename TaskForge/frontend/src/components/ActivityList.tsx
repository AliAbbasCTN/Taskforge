import type { ActivityEntry } from '../types/api';
import { FORMER_MEMBER } from '../utils/activity';
import { formatRelativeTime } from '../utils/time';

/**
 * A list of "who did what, when". Everything shown is TEXT (React escapes it),
 * including names and titles that users typed.
 *
 * The visible time is relative ("5 min ago"); the exact moment is in the
 * `title` tooltip and in the `<time>` element's `dateTime` for screen readers
 * and tools.
 */
export function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  return (
    <ul className="activity-list">
      {entries.map((entry) => (
        <li key={entry.id} className="activity-entry">
          <span>
            <strong>{entry.actorName ?? FORMER_MEMBER}</strong> {entry.message}
          </span>
          <time
            className="muted"
            dateTime={entry.createdAt}
            title={new Date(entry.createdAt).toLocaleString()}
          >
            {formatRelativeTime(entry.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}
