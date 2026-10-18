import { useEffect, useState } from 'react';

/**
 * WHAT: Returns `value`, but only after it has stopped changing for `delayMs`.
 *
 * WHY: a search box that fires a request on every keystroke sends "p", "pr",
 * "pro", "proj" ... - four requests, three of them instantly out of date.
 * Debouncing waits for a short pause in typing, so one request is sent for what
 * the person actually meant to search.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    // Cleanup runs before the next effect and on unmount: a newer keystroke
    // cancels the pending update.
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
