import { describe, expect, it } from 'vitest';
import type { AppNotification } from '../types/api';
import { notificationPath } from './notifications';

const base: AppNotification = {
  id: 'n1',
  type: 'TASK_ASSIGNED',
  message: 'x',
  projectId: 'p1',
  boardId: 'b1',
  taskId: 't1',
  readAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  actor: null,
  project: { id: 'p1', name: 'Apollo', organizationId: 'o1' },
};

describe('notificationPath', () => {
  it('links straight to the task when there is one', () => {
    expect(notificationPath(base)).toBe(
      '/orgs/o1/projects/p1/boards/b1/tasks/t1',
    );
  });

  it('links to the project when the notification is not about a task', () => {
    expect(
      notificationPath({ ...base, type: 'ADDED_TO_PROJECT', boardId: null, taskId: null }),
    ).toBe('/orgs/o1/projects/p1');
  });
});
