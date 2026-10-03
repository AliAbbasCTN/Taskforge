import { isUuid } from './is-uuid';

describe('isUuid', () => {
  it('accepts canonical UUIDs in any letter case', () => {
    expect(isUuid('aaaaaaaa-0000-4000-8000-000000000001')).toBe(true);
    expect(isUuid('AAAAAAAA-0000-4000-8000-000000000001')).toBe(true);
  });

  it.each([
    'not-a-uuid',
    '',
    '123',
    'aaaaaaaa-0000-4000-8000-00000000000', // one character short
    'aaaaaaaa-0000-4000-8000-0000000000012', // one character long
    'gggggggg-0000-4000-8000-000000000001', // non-hex characters
    "aaaaaaaa-0000-4000-8000-000000000001'; DROP TABLE users;--",
  ])('rejects %p', (value) => {
    expect(isUuid(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid({})).toBe(false);
  });
});
