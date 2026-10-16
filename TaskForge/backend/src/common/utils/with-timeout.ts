/**
 * WHAT: Gives up waiting for a promise after `ms` milliseconds.
 *
 * WHY: some calls simply never answer when a dependency is down - a Redis
 * client may queue a command forever while it waits to reconnect. Waiting
 * forever inside an HTTP request would hang the user's request, which is far
 * worse than the failure we're trying to wait out. A timeout turns "no
 * answer" into an error we can handle (here: fall back to doing the work
 * inline).
 *
 * NOTE: it stops WAITING, it does not cancel the underlying work - a call
 * that "timed out" may still complete later. Anything guarded by this must
 * therefore be safe to run twice (idempotent); see `NotificationsService`.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'Operation',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
