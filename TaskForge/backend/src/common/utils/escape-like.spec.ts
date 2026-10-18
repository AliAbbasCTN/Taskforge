import { escapeLike } from './escape-like';

describe('escapeLike', () => {
  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
  });

  it('leaves ordinary text, including quotes and unicode, alone', () => {
    expect(escapeLike("Apollo's 'plan' ✓")).toBe("Apollo's 'plan' ✓");
    expect(escapeLike('')).toBe('');
  });
});
