/**
 * The name under which the JWT bearer scheme is registered in the OpenAPI
 * document. Controllers reference it with `@ApiBearerAuth(BEARER_AUTH_NAME)`;
 * the scheme itself is declared once in `docs/swagger.ts`. A constant keeps the
 * two in sync - a typo here would silently produce routes that look public.
 */
export const BEARER_AUTH_NAME = 'access-token';
