const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * WHAT: True only if `value` is a string in canonical UUID form
 * (8-4-4-4-12 hex digits).
 *
 * WHY guards need this: NestJS runs guards BEFORE pipes. A route's
 * `ParseUUIDPipe` therefore never gets the chance to reject a malformed ID
 * like `/organizations/not-a-uuid/...` - the tenant/ownership guards run
 * first and would hand that raw string to Prisma. Our ID columns are
 * PostgreSQL `uuid` columns, so a malformed value makes the query itself
 * fail with a database error instead of returning "no row". The guards call
 * this first and answer 404, exactly as they would for an ID that is
 * well-formed but doesn't exist.
 */
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);
