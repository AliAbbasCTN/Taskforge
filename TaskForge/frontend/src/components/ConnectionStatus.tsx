import { useConnectionState } from '../hooks/useRealtime';

const LABEL = {
  connected: 'Live',
  connecting: 'Connecting…',
  disconnected: 'Offline',
} as const;

/**
 * A small "is live updating working?" indicator. People should be able to tell
 * the difference between "nothing has changed" and "I stopped receiving
 * changes". When offline the app still works - it just refreshes on actions
 * and reloads rather than by itself.
 */
export function ConnectionStatus() {
  const state = useConnectionState();
  return (
    <p className={`live live-${state}`} role="status">
      <span className="live-dot" aria-hidden="true" />
      {LABEL[state]}
    </p>
  );
}
