import {
  adapterRedisOptions,
  parseRedisUrl,
  reconnectDelayMs,
} from './redis-config';

describe('parseRedisUrl', () => {
  it('parses a plain local URL, defaulting the port', () => {
    expect(parseRedisUrl('redis://localhost')).toEqual({
      host: 'localhost',
      port: 6379,
      username: undefined,
      password: undefined,
      db: undefined,
    });
  });

  it('reads host, port, password and database', () => {
    expect(parseRedisUrl('redis://:s3cret@cache.example.com:6380/2')).toEqual({
      host: 'cache.example.com',
      port: 6380,
      username: undefined,
      password: 's3cret',
      db: 2,
    });
  });

  it('decodes percent-encoded credentials', () => {
    const options = parseRedisUrl('redis://app:p%40ss%3Aword@host:6379');

    expect(options.username).toBe('app');
    expect(options.password).toBe('p@ss:word');
  });

  it('enables TLS for rediss://', () => {
    expect(parseRedisUrl('rediss://host:6380').tls).toEqual({});
    expect(parseRedisUrl('redis://host:6380').tls).toBeUndefined();
  });

  it('rejects other protocols and a bad database number', () => {
    expect(() => parseRedisUrl('http://localhost:6379')).toThrow(/protocol/);
    expect(() => parseRedisUrl('redis://localhost:6379/abc')).toThrow(
      /database/,
    );
    expect(() => parseRedisUrl('not a url')).toThrow();
  });
});

describe('reconnectDelayMs', () => {
  it('grows with each attempt but never exceeds five seconds', () => {
    expect(reconnectDelayMs(1)).toBe(200);
    expect(reconnectDelayMs(5)).toBe(1000);
    expect(reconnectDelayMs(25)).toBe(5000);
    expect(reconnectDelayMs(10_000)).toBe(5000);
  });
});

describe('adapterRedisOptions', () => {
  it('never gives up on queued commands (the fix for the startup crash)', () => {
    const options = adapterRedisOptions('redis://localhost:6379');
    // `null` means "wait for Redis" rather than reject after 20 attempts.
    expect(options.maxRetriesPerRequest).toBeNull();
    expect(options.retryStrategy).toBe(reconnectDelayMs);
  });

  it('keeps everything parseRedisUrl understood', () => {
    expect(
      adapterRedisOptions('rediss://u:p%40ss@cache.example.com:6380/2'),
    ).toMatchObject({
      host: 'cache.example.com',
      port: 6380,
      username: 'u',
      password: 'p@ss',
      db: 2,
      tls: {},
    });
  });
});
