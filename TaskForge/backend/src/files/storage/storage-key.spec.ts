import { resolve } from 'node:path';
import { buildStorageKey, resolveInside } from './storage-key';

const ID = '11111111-1111-4111-8111-111111111111';

describe('buildStorageKey', () => {
  it('has the documented shape and is different every time', () => {
    const parts = {
      organizationId: ID,
      projectId: ID,
      taskId: ID,
      extension: 'png',
    };
    const a = buildStorageKey(parts);
    const b = buildStorageKey(parts);
    expect(a).toMatch(
      new RegExp(`^attachments/${ID}/${ID}/${ID}/[0-9a-f-]{36}\\.png$`),
    );
    expect(a).not.toBe(b);
  });
});

describe('resolveInside', () => {
  const root = resolve('/srv/uploads');

  it('resolves a normal key inside the root', () => {
    expect(resolveInside(root, 'attachments/a/b.png')).toBe(
      resolve(root, 'attachments/a/b.png'),
    );
  });

  it.each([
    '../outside.txt',
    'attachments/../../outside.txt',
    '/etc/passwd',
    'a\0b',
    'a\\b',
    '',
    '.',
    'attachments/..',
  ])('rejects the hostile key %j', (key) => {
    expect(() => resolveInside(root, key)).toThrow('Invalid storage key');
  });
});
