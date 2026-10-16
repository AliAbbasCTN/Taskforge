import { parseRedisUrl } from './redis-config';

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
