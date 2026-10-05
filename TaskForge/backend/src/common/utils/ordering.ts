/**
 * WHAT: Pure helpers for keeping an ordered list (columns on a board, tasks
 * in a column) numbered 0, 1, 2... without gaps.
 *
 * WHY "dense positions, renumber on change" rather than alternatives:
 *   - A UNIQUE (parent, position) constraint would make swapping two items
 *     impossible without temporarily violating it.
 *   - Fractional positions (1.5 between 1 and 2) avoid renumbering but need
 *     occasional rebalancing and are harder to reason about and test.
 *   - Boards hold tens of items, not millions, so renumbering a handful of
 *     rows inside one transaction is cheap and keeps the data trivially easy
 *     to read ("position 0 is first").
 *
 * These functions only compute WHAT the new order is; the services persist
 * it inside a database transaction.
 */

/**
 * Returns `ids` with `movedId` placed at `targetIndex` (clamped into range;
 * `undefined` means the end). If `movedId` is not in `ids` yet it is simply
 * inserted - so this serves "add at position", "move within list" alike.
 */
export function reorder(
  ids: string[],
  movedId: string,
  targetIndex?: number,
): string[] {
  const without = ids.filter((id) => id !== movedId);
  const index =
    targetIndex === undefined
      ? without.length
      : Math.max(0, Math.min(targetIndex, without.length));
  return [...without.slice(0, index), movedId, ...without.slice(index)];
}

export interface PositionedRow {
  id: string;
  position: number;
}

/**
 * Compares the current rows with the desired order and returns ONLY the rows
 * whose position must change, so a move touches the minimum number of rows.
 */
export function positionChanges(
  currentRows: PositionedRow[],
  newOrder: string[],
): PositionedRow[] {
  const current = new Map(currentRows.map((row) => [row.id, row.position]));
  return newOrder
    .map((id, position) => ({ id, position }))
    .filter((row) => current.get(row.id) !== row.position);
}
