import { EventEmitter } from 'node:events';
import {
  RedisEventSource,
  WarnLogger,
  watchRedisClient,
} from './redis-connection-logger';

function setup(intervalMs = 1000) {
  const client = new EventEmitter();
  const warnings: string[] = [];
  const logs: string[] = [];
  const logger: WarnLogger = {
    warn: (m) => warnings.push(m),
    log: (m) => logs.push(m),
  };
  let time = 0;
  watchRedisClient(client as unknown as RedisEventSource, 'Adapter', logger, {
    intervalMs,
    now: () => time,
  });
  return {
    client,
    warnings,
    logs,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const refused = () => Object.assign(new Error(''), { code: 'ECONNREFUSED' });

describe('watchRedisClient', () => {
  it('registers an error listener, so an error event can never crash the process', () => {
    const { client } = setup();
    expect(client.listenerCount('error')).toBe(1);
    expect(() => client.emit('error', refused())).not.toThrow();
  });

  it('uses the error code when the message is empty (IPv4/IPv6 AggregateError)', () => {
    const { client, warnings } = setup();
    client.emit('error', refused());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ECONNREFUSED');
    expect(warnings[0]).toContain('Adapter');
  });

  it('logs the first error, then stays quiet until the interval has passed', () => {
    const { client, warnings, advance } = setup(1000);

    client.emit('error', refused());
    client.emit('error', refused());
    client.emit('error', refused());
    expect(warnings).toHaveLength(1);

    advance(1000);
    client.emit('error', refused());
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain('2 similar errors not shown');
  });

  it('says so when the connection is restored, and starts fresh afterwards', () => {
    const { client, warnings, logs } = setup();

    client.emit('ready'); // a normal first connection: nothing to announce
    expect(logs).toHaveLength(0);

    client.emit('error', refused());
    client.emit('ready');
    expect(logs).toEqual(['Adapter: connection to Redis restored']);

    client.emit('error', refused()); // a NEW outage is logged immediately
    expect(warnings).toHaveLength(2);
  });
});
