/**
 * Where a moved item lands in a list of `length` OTHER items.
 *
 * `undefined` means "at the end"; anything out of range is clamped. This is
 * the exact rule the backend uses (`reorder()` in the API), and it has to
 * stay identical: the board shows the result of this function immediately,
 * then the server's answer replaces it. If the two ever disagreed, you would
 * see items jump after every drop.
 */
export function clampIndex(position: number | undefined, length: number): number {
  if (position === undefined) {
    return length;
  }
  return Math.max(0, Math.min(position, length));
}
