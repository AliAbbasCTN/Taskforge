import { positionChanges, reorder } from './ordering';

describe('reorder', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('moves an item forward and backward', () => {
    expect(reorder(ids, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorder(ids, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('puts the item last when no index is given', () => {
    expect(reorder(ids, 'a')).toEqual(['b', 'c', 'd', 'a']);
  });

  it('clamps out-of-range and negative indexes', () => {
    expect(reorder(ids, 'a', 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(reorder(ids, 'd', -5)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('inserts an item that is not in the list yet', () => {
    expect(reorder(ids, 'x', 1)).toEqual(['a', 'x', 'b', 'c', 'd']);
  });

  it('does not mutate its input', () => {
    reorder(ids, 'a', 3);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('positionChanges', () => {
  const rows = [
    { id: 'a', position: 0 },
    { id: 'b', position: 1 },
    { id: 'c', position: 2 },
  ];

  it('returns nothing when the order is unchanged', () => {
    expect(positionChanges(rows, ['a', 'b', 'c'])).toEqual([]);
  });

  it('returns only the rows whose position changed', () => {
    expect(positionChanges(rows, ['b', 'a', 'c'])).toEqual([
      { id: 'b', position: 0 },
      { id: 'a', position: 1 },
    ]);
  });

  it('renumbers the survivors after a removal', () => {
    expect(positionChanges(rows, ['b', 'c'])).toEqual([
      { id: 'b', position: 0 },
      { id: 'c', position: 1 },
    ]);
  });
});
