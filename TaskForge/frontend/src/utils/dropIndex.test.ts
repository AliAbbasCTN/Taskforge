import { describe, expect, it } from 'vitest';
import { computeDropIndex } from './dropIndex';

// Three 40px cards stacked from y=100: A (100-140), B (140-180), C (180-220).
const rects = [
  { id: 'A', top: 100, height: 40 },
  { id: 'B', top: 140, height: 40 },
  { id: 'C', top: 180, height: 40 },
];

describe('computeDropIndex', () => {
  it('drops at the top when released above every card midpoint', () => {
    expect(computeDropIndex(rects, 90, 'X')).toBe(0);
    expect(computeDropIndex(rects, 115, 'X')).toBe(0);
  });

  it('counts the cards whose midpoint is above the cursor', () => {
    expect(computeDropIndex(rects, 125, 'X')).toBe(1);
    expect(computeDropIndex(rects, 165, 'X')).toBe(2);
  });

  it('drops at the bottom when released below everything', () => {
    expect(computeDropIndex(rects, 500, 'X')).toBe(3);
  });

  it('is 0 for an empty lane', () => {
    expect(computeDropIndex([], 300, 'X')).toBe(0);
  });

  it('skips the dragged card, matching how the server counts', () => {
    // Dragging A downward to just past B: among the OTHERS (B, C) that is
    // index 1, i.e. "after B" - not 2.
    expect(computeDropIndex(rects, 165, 'A')).toBe(1);
  });
});
