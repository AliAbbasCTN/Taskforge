import { formatActivityMessage } from './activity-message';

const msg = (action: string, targetName: string | null, metadata?: unknown) =>
  formatActivityMessage({ action, targetName, metadata });

describe('formatActivityMessage', () => {
  it.each([
    ['task.created', 'Fix login', undefined, 'created task “Fix login”'],
    ['task.deleted', 'Fix login', undefined, 'deleted task “Fix login”'],
    ['project.deleted', 'Apollo', undefined, 'deleted project “Apollo”'],
    ['project.archived', 'Apollo', undefined, 'archived project “Apollo”'],
    [
      'comment.created',
      'Fix login',
      undefined,
      'commented on task “Fix login”',
    ],
    [
      'task.assigned',
      'Fix login',
      { assigneeName: 'Max' },
      'assigned task “Fix login” to Max',
    ],
    [
      'task.unassigned',
      'Fix login',
      { assigneeName: 'Max' },
      'unassigned Max from task “Fix login”',
    ],
    [
      'task.moved',
      'Fix login',
      { from: 'To Do', to: 'Done' },
      'moved task “Fix login” from To Do to Done',
    ],
    [
      'attachment.added',
      'Fix login',
      { fileName: 'a.png' },
      'attached a.png to task “Fix login”',
    ],
    [
      'attachment.removed',
      'Fix login',
      { fileName: 'a.png' },
      'removed a.png from task “Fix login”',
    ],
    [
      'organization.member_added',
      'Max',
      { role: 'MANAGER' },
      'added Max to the organization as manager',
    ],
    [
      'project.member_role_changed',
      'Max',
      { from: 'MEMBER', to: 'LEAD' },
      'changed Max’s project role from member to lead',
    ],
    [
      'project.member_removed',
      'Max',
      undefined,
      'removed Max from the project',
    ],
  ])('%s', (action, name, metadata, expected) => {
    expect(msg(action, name, metadata)).toBe(expected);
  });

  it('names changed fields in plain words', () => {
    expect(msg('task.updated', 'T', { fields: ['title', 'dueDate'] })).toBe(
      'updated task “T” (title, due date)',
    );
    expect(
      msg('task.updated', 'New', { fields: ['title'], previousTitle: 'Old' }),
    ).toBe('updated task “New” (title), previously “Old”');
  });

  it('lists labels, or says there are none', () => {
    expect(msg('task.labels_changed', 'T', { labels: ['bug', 'ui'] })).toBe(
      'changed the labels on task “T” (bug, ui)',
    );
    expect(msg('task.labels_changed', 'T', { labels: [] })).toBe(
      'changed the labels on task “T” (none)',
    );
  });

  it('degrades gracefully when details are missing or the action is unknown', () => {
    expect(msg('task.moved', null, null)).toBe(
      'moved task an item from a column to another column',
    );
    expect(msg('something.new', 'X')).toBe('performed something.new');
  });
});
