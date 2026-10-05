import type { ApiErrorBody, AuthTokens } from '../types/api';
import { tokenStore } from './tokenStore';

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

/**
 * WHAT: An error from the API (or from failing to reach it), in one shape
 * the UI can display. `status` is the HTTP status, or 0 if the request never
 * got a response (server down, offline, blocked by CORS).
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header and the refresh-on-401 behaviour. Used by
   * login/register/refresh themselves, where a 401 means "wrong credentials",
   * not "your access token expired". */
  skipAuth?: boolean;
}

/**
 * Called when the session is definitively over (the refresh token was
 * rejected). The AuthProvider registers a handler that logs the user out of
 * the UI; keeping it a callback means this file knows nothing about React.
 */
let onAuthFailure: (() => void) | null = null;

export function setAuthFailureHandler(handler: (() => void) | null): void {
  onAuthFailure = handler;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const accessToken = tokenStore.getAccessToken();
  if (!options.skipAuth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    return await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // `fetch` only rejects when no response arrived at all.
    throw new ApiError(
      0,
      'Could not reach the server. Check your connection and try again.',
    );
  }
}

/**
 * WHAT: Exchanges the stored refresh token for a new token pair.
 *
 * WHY it is "single-flight" (at most ONE refresh request at a time, shared by
 * everyone who asks): the backend ROTATES refresh tokens and remembers only
 * the latest one. If two requests both got a 401 and each sent a refresh, the
 * second would present an already-used token - which the server cannot tell
 * apart from a stolen token being replayed - so it would be rejected and the
 * user logged out for no reason. Sharing one in-flight promise makes every
 * waiting request wait for the same result. (React StrictMode runs effects
 * twice in development, which hits exactly this case on page load.)
 *
 * Returns true if a fresh access token is now available.
 */
let refreshInFlight: Promise<boolean> | null = null;

export function refreshTokens(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function performRefresh(): Promise<boolean> {
  // Read at call time, not cached: another browser tab may have rotated it.
  const refreshToken = tokenStore.getRefreshToken();
  if (!refreshToken) {
    return false;
  }

  let response: Response;
  try {
    response = await send('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      skipAuth: true,
    });
  } catch {
    // Network trouble is not proof the session is dead - keep the tokens and
    // let the caller fail this one request; the next one can try again.
    return false;
  }

  if (!response.ok) {
    // The server said no: the refresh token is expired, revoked, or reused.
    tokenStore.clear();
    onAuthFailure?.();
    return false;
  }

  tokenStore.set((await response.json()) as AuthTokens);
  return true;
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Empty or non-JSON body; handled below.
  }

  if (!response.ok) {
    const { message } = (body ?? {}) as Partial<ApiErrorBody>;
    const details = Array.isArray(message) ? message : [];
    const text = Array.isArray(message)
      ? message.join('. ')
      : (message ?? `Request failed (${response.status})`);
    throw new ApiError(response.status, text, details);
  }

  return body as T;
}

/**
 * WHAT: Every call to the backend goes through here.
 *
 * Responsibilities: attach the access token, turn failures into `ApiError`,
 * and - the interesting part - recover from an EXPIRED access token
 * transparently: on a 401 it refreshes the session once and replays the
 * request, so a page never notices that the 15-minute token ran out.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const tokenUsed = tokenStore.getAccessToken();
  let response = await send(path, options);

  if (response.status === 401 && !options.skipAuth) {
    // If the token changed while this request was in flight, another request
    // already refreshed the session - just replay with the new token instead
    // of rotating the refresh token a second time for nothing.
    const current = tokenStore.getAccessToken();
    const alreadyRefreshed = current !== null && current !== tokenUsed;

    if (alreadyRefreshed || (await refreshTokens())) {
      response = await send(path, options);
    }
  }

  return parse<T>(response);
}
