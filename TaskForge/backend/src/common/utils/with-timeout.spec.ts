import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns the result when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('passes through the original rejection', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 1000),
    ).rejects.toThrow('boom');
  });

  it('rejects with a clear message when the promise takes too long', async () => {
    const never = new Promise<string>(() => undefined);
    const result = withTimeout(never, 500, 'Enqueue');
    const assertion = expect(result).rejects.toThrow(
      'Enqueue timed out after 500ms',
    );

    jest.advanceTimersByTime(500);

    await assertion;
  });

  it('clears its timer so it never keeps the process alive', async () => {
    await withTimeout(Promise.resolve(1), 10_000);

    expect(jest.getTimerCount()).toBe(0);
  });
});
