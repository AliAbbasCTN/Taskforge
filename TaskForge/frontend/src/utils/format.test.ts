import { describe, expect, it } from 'vitest';
import { formatDueDate, initialOf, isOverdue } from './format';

describe('formatDueDate', () => {
  it('shows the stored calendar day regardless of the viewer timezone', () => {
    expect(formatDueDate('2026-12-31T00:00:00.000Z', 'en-US')).toBe('Dec 31');
  });
});

describe('isOverdue', () => {
  const now = new Date('2026-06-15T15:30:00.000Z');

  it('is true for an earlier day', () => {
    expect(isOverdue('2026-06-14T00:00:00.000Z', now)).toBe(true);
  });

  it('is false for today and for later days', () => {
    expect(isOverdue('2026-06-15T00:00:00.000Z', now)).toBe(false);
    expect(isOverdue('2026-06-16T00:00:00.000Z', now)).toBe(false);
  });
});

describe('initialOf', () => {
  it('uppercases the first letter and tolerates blanks', () => {
    expect(initialOf('  ada')).toBe('A');
    expect(initialOf('')).toBe('?');
  });
});
