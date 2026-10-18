/**
 * WHAT: Makes a user's text safe to use inside a SQL `LIKE` / `ILIKE` pattern
 * (which is what Prisma's `contains` becomes).
 *
 * WHY: Prisma parameterizes the value, so SQL INJECTION is not possible - but
 * `%` and `_` are WILDCARDS inside a LIKE pattern. Without escaping, searching
 * for "100%" would match "100" followed by anything, and "_" would match any
 * single character. We put a backslash (PostgreSQL's default LIKE escape
 * character) before `\`, `%` and `_` so they match themselves.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
