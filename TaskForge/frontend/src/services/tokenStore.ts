import type { AuthTokens } from '../types/api';

/**
 * WHAT: The one place the browser keeps the user's credentials.
 *
 * WHERE each token lives, and WHY:
 *
 *  - ACCESS token -> a plain module variable (JavaScript memory only).
 *    It is short-lived (15 minutes) and is sent with every request. Keeping
 *    it out of any storage means a page-reload clears it, and nothing can
 *    read it back out of `localStorage`.
 *
 *  - REFRESH token -> `localStorage`.
 *    It must survive a page reload, or users would log in again on every
 *    refresh. That is a deliberate trade-off: anything in `localStorage` can
 *    be read by any script running on the page, so a successful XSS attack
 *    could steal it. The industry-standard hardening is an `httpOnly` cookie
 *    (invisible to JavaScript), which needs backend changes (cookie
 *    handling, CSRF protection) and is scheduled for Phase 20's security
 *    review. Mitigations that exist today: refresh tokens ROTATE (a stolen
 *    one stops working the moment the real user refreshes), and React
 *    escapes everything it renders, which closes the most common XSS route.
 *
 * `localStorage` access is wrapped in try/catch because it can throw (for
 * example in some private-browsing modes) and a storage failure must never
 * crash the app - the user simply stays logged in for this tab only.
 */
const REFRESH_TOKEN_KEY = 'taskforge.refreshToken';

let accessToken: string | null = null;

export const tokenStore = {
  getAccessToken(): string | null {
    return accessToken;
  },

  getRefreshToken(): string | null {
    try {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  },

  set(tokens: AuthTokens): void {
    accessToken = tokens.accessToken;
    try {
      localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    } catch {
      // Storage unavailable: session lasts until the tab is closed.
    }
  },

  clear(): void {
    accessToken = null;
    try {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  },
};
