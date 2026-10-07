import { toPaginated, toSkipTake } from './pagination';

describe('toSkipTake', () => {
  it('turns a 1-based page into skip/take', () => {
    expect(toSkipTake(1, 20)).toEqual({ skip: 0, take: 20 });
    expect(toSkipTake(3, 20)).toEqual({ skip: 40, take: 20 });
    expect(toSkipTake(2, 5)).toEqual({ skip: 5, take: 5 });
  });
});

describe('toPaginated', () => {
  it('computes the page count, rounding up', () => {
    expect(toPaginated([], 41, 1, 20).totalPages).toBe(3);
    expect(toPaginated([], 40, 1, 20).totalPages).toBe(2);
  });

  it('reports one page for an empty result', () => {
    expect(toPaginated([], 0, 1, 20).totalPages).toBe(1);
  });

  it('carries the items and metadata through', () => {
    expect(toPaginated(['a'], 1, 1, 20)).toEqual({
      items: ['a'],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  });
});
