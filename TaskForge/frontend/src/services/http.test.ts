import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, setAuthFailureHandler } from './http';
import { tokenStore } from './tokenStore';

/**
 * Tests the part of the frontend that is easiest to get subtly wrong: how the
 * HTTP client recovers from an expired access token. `fetch` is replaced with
 * a fake "server", so no backend is needed.
 */

function installFakeLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const authHeader = (init?: RequestInit) =>
  (init?.headers as Record<string, string> | undefined)?.Authorization;

const urlOf = (input: RequestInfo | URL) => String(input);

describe('apiRequest', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = installFakeLocalStorage();
    tokenStore.clear();
    setAuthFailureHandler(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the access token as a Bearer header', async () => {
    tokenStore.set({ accessToken: 'A1', refreshToken: 'R1' });
    const fetchMock = vi.fn(async () => json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/data')).resolves.toEqual({ ok: true });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(authHeader(init)).toBe('Bearer A1');
  });

  it('on a 401, refreshes once, stores the ROTATED refresh token, and replays the request', async () => {
    tokenStore.set({ accessToken: 'expired', refreshToken: 'R1' });
    const refreshBodies: unknown[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (urlOf(input).endsWith('/auth/refresh')) {
          refreshBodies.push(JSON.parse(String(init?.body)));
          return json(200, { accessToken: 'A2', refreshToken: 'R2' });
        }
        return authHeader(init) === 'Bearer A2'
          ? json(200, { data: 'secret' })
          : json(401, { statusCode: 401, message: 'Unauthorized' });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/data')).resolves.toEqual({ data: 'secret' });

    expect(refreshBodies).toEqual([{ refreshToken: 'R1' }]);
    expect(tokenStore.getAccessToken()).toBe('A2');
    expect(storage.get('taskforge.refreshToken')).toBe('R2');
  });

  it('shares ONE refresh between concurrent 401s (the server rotates tokens, so a second refresh would look like token theft)', async () => {
    tokenStore.set({ accessToken: 'expired', refreshToken: 'R1' });
    let refreshCalls = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (urlOf(input).endsWith('/auth/refresh')) {
          refreshCalls += 1;
          // Take a moment, so the other requests arrive while it is in flight.
          await new Promise((resolve) => setTimeout(resolve, 10));
          return json(200, { accessToken: 'A2', refreshToken: 'R2' });
        }
        return authHeader(init) === 'Bearer A2'
          ? json(200, { ok: true })
          : json(401, { statusCode: 401, message: 'Unauthorized' });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.all([
      apiRequest('/one'),
      apiRequest('/two'),
      apiRequest('/three'),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
  });

  it('ends the session when the refresh token is rejected', async () => {
    tokenStore.set({ accessToken: 'expired', refreshToken: 'dead' });
    const onFailure = vi.fn();
    setAuthFailureHandler(onFailure);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(401, { statusCode: 401, message: 'Unauthorized' })),
    );

    await expect(apiRequest('/data')).rejects.toMatchObject({ status: 401 });

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(tokenStore.getAccessToken()).toBeNull();
    expect(tokenStore.getRefreshToken()).toBeNull();
  });

  it('keeps the session on a network failure during refresh (transient, not proof the session is dead)', async () => {
    tokenStore.set({ accessToken: 'expired', refreshToken: 'R1' });
    const onFailure = vi.fn();
    setAuthFailureHandler(onFailure);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (urlOf(input).endsWith('/auth/refresh')) {
          throw new TypeError('network down');
        }
        return json(401, { statusCode: 401, message: 'Unauthorized' });
      }),
    );

    await expect(apiRequest('/data')).rejects.toMatchObject({ status: 401 });

    expect(onFailure).not.toHaveBeenCalled();
    expect(tokenStore.getRefreshToken()).toBe('R1');
  });

  it('does not try to refresh when there is no refresh token', async () => {
    const fetchMock = vi.fn(async () =>
      json(401, { statusCode: 401, message: 'Unauthorized' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/data')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh for skipAuth calls: a 401 from login means wrong password', async () => {
    tokenStore.set({ accessToken: 'A1', refreshToken: 'R1' });
    const fetchMock = vi.fn(async () =>
      json(401, { statusCode: 401, message: 'Invalid email or password' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiRequest('/auth/login', { method: 'POST', body: {}, skipAuth: true }),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid email or password' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(authHeader(init)).toBeUndefined();
  });

  it('turns validation errors (message arrays) into one readable sentence plus details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(400, {
          statusCode: 400,
          message: ['email must be a valid email address', 'password too short'],
        }),
      ),
    );

    const error = (await apiRequest('/x').catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe(
      'email must be a valid email address. password too short',
    );
    expect(error.details).toHaveLength(2);
  });

  it('reports an unreachable server as status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(apiRequest('/x')).rejects.toMatchObject({ status: 0 });
  });

  it('returns undefined for 204 No Content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));

    await expect(apiRequest('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
