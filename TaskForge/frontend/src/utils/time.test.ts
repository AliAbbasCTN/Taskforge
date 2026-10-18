import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './time';

const NOW = new Date('2026-10-18T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('formatRelativeTime', () => {
  it.each([
    [0, 'just now'],
    [59_000, 'just now'],
    [60_000, '1 min ago'],
    [5 * 60_000 + 30_000, '5 min ago'],
    [3_600_000, '1 h ago'],
    [23 * 3_600_000, '23 h ago'],
    [24 * 3_600_000, '1 d ago'],
    [6 * 24 * 3_600_000, '6 d ago'],
  ])('%s ms ago -> %s', (ms, expected) => {
    expect(formatRelativeTime(ago(ms), NOW)).toBe(expected);
  });

  it('shows "just now" for a timestamp slightly in the future (clock skew)', () => {
    expect(formatRelativeTime(ago(-5000), NOW)).toBe('just now');
  });

  it('switches to a calendar date after a week', () => {
    const result = formatRelativeTime(ago(8 * 24 * 3_600_000), NOW);
    expect(result).toContain('2026');
    expect(result).not.toContain('ago');
  });
});
