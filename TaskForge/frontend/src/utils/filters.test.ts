import { describe, expect, it } from 'vitest';
import {
  filtersFromSearchParams,
  filtersToQuery,
  filtersToSearchParams,
  hasActiveFilters,
} from './filters';

describe('filtersFromSearchParams', () => {
  it('reads every supported filter', () => {
    const params = new URLSearchParams(
      'priority=HIGH&assigneeId=u1&labelId=l1&overdue=true',
    );

    expect(filtersFromSearchParams(params)).toEqual({
      priority: 'HIGH',
      assigneeId: 'u1',
      labelId: 'l1',
      overdue: true,
    });
  });

  it('ignores an unknown priority and anything but overdue=true', () => {
    const params = new URLSearchParams('priority=SOON&overdue=false&view=list');

    expect(filtersFromSearchParams(params)).toEqual({});
  });
});

describe('filtersToSearchParams', () => {
  it('replaces existing filters but keeps unrelated parameters', () => {
    const base = new URLSearchParams('view=list&priority=LOW&labelId=old');

    const result = filtersToSearchParams({ priority: 'URGENT' }, base);

    expect(result.get('view')).toBe('list');
    expect(result.get('priority')).toBe('URGENT');
    expect(result.has('labelId')).toBe(false);
  });

  it('does not mutate the base params', () => {
    const base = new URLSearchParams('priority=LOW');

    filtersToSearchParams({}, base);

    expect(base.get('priority')).toBe('LOW');
  });

  it('round-trips', () => {
    const filters = { priority: 'HIGH' as const, overdue: true as const };

    expect(filtersFromSearchParams(filtersToSearchParams(filters))).toEqual(filters);
  });
});

describe('filtersToQuery / hasActiveFilters', () => {
  it('is empty when no filter is set', () => {
    expect(filtersToQuery({})).toBe('');
    expect(hasActiveFilters({})).toBe(false);
  });

  it('serialises the active filters', () => {
    expect(filtersToQuery({ priority: 'HIGH', overdue: true })).toBe(
      'priority=HIGH&overdue=true',
    );
    expect(hasActiveFilters({ overdue: true })).toBe(true);
  });
});
