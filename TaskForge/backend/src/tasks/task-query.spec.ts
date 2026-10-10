// class-transformer reads the decorators' type metadata through the Reflect
// API, which Nest loads at startup (main.ts) but a bare Jest test does not.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { TaskPriority } from '@prisma/client';
import { TaskFilterDto } from './dto/task-filter.dto';
import {
  buildTaskFilterWhere,
  buildTaskOrderBy,
  startOfTodayUtc,
} from './task-query';

describe('TaskFilterDto query-string parsing', () => {
  // Mirrors main.ts: `transform: true` + `enableImplicitConversion: true`.
  const parse = (query: Record<string, string>) =>
    plainToInstance(TaskFilterDto, query, { enableImplicitConversion: true });

  it('parses overdue=false as FALSE (not the string "false", which is truthy)', () => {
    expect(parse({ overdue: 'false' }).overdue).toBe(false);
  });

  it('parses overdue=true as true', () => {
    expect(parse({ overdue: 'true' }).overdue).toBe(true);
  });

  it('leaves overdue undefined when absent or empty', () => {
    expect(parse({}).overdue).toBeUndefined();
    expect(parse({ overdue: '' }).overdue).toBeUndefined();
  });

  it('passes junk through so @IsBoolean() can reject it with a 400', () => {
    expect(parse({ overdue: 'maybe' }).overdue).toBe('maybe');
  });
});

describe('buildTaskFilterWhere', () => {
  const now = new Date('2026-06-15T15:30:00.000Z');

  it('builds an empty clause for no filters', () => {
    expect(buildTaskFilterWhere({}, now)).toEqual({});
  });

  it('combines every supplied filter', () => {
    expect(
      buildTaskFilterWhere(
        { priority: TaskPriority.HIGH, assigneeId: 'u1', labelId: 'l1' },
        now,
      ),
    ).toEqual({
      priority: 'HIGH',
      assigneeId: 'u1',
      labels: { some: { labelId: 'l1' } },
    });
  });

  it('treats overdue=true as due before the start of today (UTC)', () => {
    expect(buildTaskFilterWhere({ overdue: true }, now)).toEqual({
      dueDate: { lt: new Date('2026-06-15T00:00:00.000Z') },
    });
  });

  it('ignores overdue=false (it means "no overdue filter", not "only not-overdue")', () => {
    expect(buildTaskFilterWhere({ overdue: false }, now)).toEqual({});
  });
});

describe('buildTaskOrderBy', () => {
  it('always ends with an id tie-breaker so paging is stable', () => {
    for (const field of [
      'createdAt',
      'dueDate',
      'priority',
      'title',
    ] as const) {
      const orderBy = buildTaskOrderBy(field, 'asc');
      expect(orderBy[orderBy.length - 1]).toEqual({ id: 'asc' });
    }
  });

  it('sorts tasks with no due date last in both directions', () => {
    expect(buildTaskOrderBy('dueDate', 'asc')[0]).toEqual({
      dueDate: { sort: 'asc', nulls: 'last' },
    });
    expect(buildTaskOrderBy('dueDate', 'desc')[0]).toEqual({
      dueDate: { sort: 'desc', nulls: 'last' },
    });
  });

  it('honours the direction for other fields', () => {
    expect(buildTaskOrderBy('title', 'desc')[0]).toEqual({ title: 'desc' });
  });
});

describe('startOfTodayUtc', () => {
  it('drops the time of day', () => {
    expect(startOfTodayUtc(new Date('2026-06-15T23:59:59.000Z'))).toEqual(
      new Date('2026-06-15T00:00:00.000Z'),
    );
  });
});
