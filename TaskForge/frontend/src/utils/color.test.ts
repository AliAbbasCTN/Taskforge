import { describe, expect, it } from 'vitest';
import { safeColor } from './color';

describe('safeColor', () => {
  it('passes valid hex colours through', () => {
    expect(safeColor('#2f4bdb')).toBe('#2f4bdb');
    expect(safeColor('#ABCDEF')).toBe('#ABCDEF');
  });

  it.each(['red', '#fff', '#12345g', 'url(javascript:alert(1))', '', '#2f4bdb; background: red'])(
    'replaces %p with a neutral grey',
    (value) => {
      expect(safeColor(value)).toBe('#7b869c');
    },
  );
});
