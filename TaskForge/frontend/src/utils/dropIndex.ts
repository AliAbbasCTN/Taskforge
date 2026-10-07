export interface TaskRect {
  id: string;
  top: number;
  height: number;
}

/**
 * WHAT: Given where the mouse was released (`clientY`) and the on-screen
 * rectangles of a lane's cards, returns the index at which the dragged card
 * should be inserted.
 *
 * HOW: a card counts as "above the cursor" if the cursor is past its vertical
 * midpoint. The answer is how many cards are above the cursor. The dragged
 * card itself is skipped, because the backend inserts at an index among the
 * OTHER cards (the moved card is taken out first) - counting it would be off
 * by one when dragging downwards within the same column.
 *
 * Kept free of the DOM (it takes plain numbers) so it can be tested.
 */
export function computeDropIndex(
  rects: TaskRect[],
  clientY: number,
  draggedId: string,
): number {
  return rects.filter(
    (rect) => rect.id !== draggedId && rect.top + rect.height / 2 < clientY,
  ).length;
}
