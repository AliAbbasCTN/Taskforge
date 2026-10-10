import { describe, expect, it } from 'vitest';
import type { ProjectChangedEvent } from '../types/api';
import { queryKeysForChange } from './realtimeInvalidation';

const event = (overrides: Partial<ProjectChangedEvent>): ProjectChangedEvent => ({
  resource: 'tasks',
  projectId: 'p1',
  at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('queryKeysForChange', () => {
  it('a task change refreshes that board, the task list and that task', () => {
    expect(
      queryKeysForChange(event({ resource: 'tasks', boardId: 'b1', taskId: 't1' })),
    ).toEqual([['board', 'b1'], ['tasks', 'b1'], ['task', 't1']]);
  });

  it('a comment change refreshes only that task\'s comments', () => {
    expect(
      queryKeysForChange(event({ resource: 'comments', taskId: 't1' })),
    ).toEqual([['comments', 't1']]);
  });

  it('a column change refreshes the board and the list', () => {
    expect(
      queryKeysForChange(event({ resource: 'columns', boardId: 'b1' })),
    ).toEqual([['board', 'b1'], ['tasks', 'b1']]);
  });

  it('a label change refreshes labels everywhere they are shown', () => {
    const keys = queryKeysForChange(event({ resource: 'labels', boardId: 'b1' }));

    expect(keys).toContainEqual(['labels']);
    expect(keys).toContainEqual(['board', 'b1']);
    expect(keys).toContainEqual(['task']);
  });

  it('a project change refreshes the project, its lists, members and boards', () => {
    expect(queryKeysForChange(event({ resource: 'project' }))).toEqual([
      ['project'],
      ['projects'],
      ['project-members'],
      ['boards'],
    ]);
  });

  it('a board change includes the board list', () => {
    expect(
      queryKeysForChange(event({ resource: 'boards', boardId: 'b1' })),
    ).toContainEqual(['boards']);
  });

  it('falls back to a broader prefix when an id is missing, rather than refreshing nothing', () => {
    expect(queryKeysForChange(event({ resource: 'tasks' }))).toEqual([
      ['board'],
      ['tasks'],
      ['task'],
    ]);
    expect(queryKeysForChange(event({ resource: 'comments' }))).toEqual([
      ['comments'],
    ]);
  });
});
