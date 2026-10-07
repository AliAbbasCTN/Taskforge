/**
 * WHAT: The shared vocabulary for paginated list endpoints.
 *
 * WHY paginate at all: an endpoint that returns "every task" works with ten
 * tasks and falls over with ten thousand - slow queries, huge responses,
 * a browser rendering thousands of rows. Pagination makes the cost of a
 * request proportional to the page size, not the table size.
 *
 * WHY page/pageSize (offset pagination) rather than cursors: it is simple,
 * lets a UI jump to "page 3", and is plenty for lists of this size. Its
 * weakness - rows shifting between pages while someone is adding data - and
 * the cursor-based alternative are discussed in docs/phase-10-concepts.md.
 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface Paginated<T> {
  items: T[];
  /** Total rows matching the filters, across ALL pages. */
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Converts a 1-based page into Prisma's `skip`/`take`. */
export function toSkipTake(
  page: number,
  pageSize: number,
): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function toPaginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): Paginated<T> {
  return {
    items,
    total,
    page,
    pageSize,
    // An empty result is "1 page" so a UI can always show "Page 1 of 1".
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
