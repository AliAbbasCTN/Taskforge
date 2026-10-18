import { ACTIVITY_SPECS } from './activity-describers';
import {
  ACTIVITY_ACTIONS,
  DescribeContext,
  DerivedActivityAction,
  LoggedActivityAction,
} from './activity.types';

const DERIVED: DerivedActivityAction[] = ['task.assigned', 'task.unassigned'];
const LOGGED = ACTIVITY_ACTIONS.filter(
  (action): action is LoggedActivityAction =>
    !DERIVED.includes(action as DerivedActivityAction),
);

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const BOARD = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';

const ctx = (overrides: Partial<DescribeContext> = {}): DescribeContext => ({
  params: {
    id: ORG,
    projectId: PROJECT,
    boardId: BOARD,
    taskId: TASK,
    userId: USER,
  },
  body: {},
  response: {},
  before: null,
  ...overrides,
});

const describe_ = (action: LoggedActivityAction, c: DescribeContext) =>
  ACTIVITY_SPECS[action].describe(c);

describe('ACTIVITY_SPECS', () => {
  it('has exactly one spec for every action a route can log (derived actions have none)', () => {
    expect(Object.keys(ACTIVITY_SPECS).sort()).toEqual([...LOGGED].sort());
    expect(
      DERIVED.every((action) =>
        (ACTIVITY_ACTIONS as readonly string[]).includes(action),
      ),
    ).toBe(true);
  });

  it.each([...LOGGED])(
    '%s never throws on an empty request/response (logging must not break requests)',
    (action) => {
      const result = describe_(action, ctx());
      expect(Array.isArray(result)).toBe(true);
      for (const draft of result) {
        expect(draft.action).toBeDefined();
        expect(draft.organizationId).toBeDefined();
      }
    },
  );

  describe('tasks', () => {
    it('task.created records the new task and its assignee name', () => {
      const [draft] = describe_(
        'task.created',
        ctx({
          response: {
            id: TASK,
            title: 'Fix login',
            priority: 'HIGH',
            assignee: { name: 'Max' },
          },
        }),
      );
      expect(draft).toMatchObject({
        organizationId: ORG,
        projectId: PROJECT,
        taskId: TASK,
        action: 'task.created',
        targetType: 'task',
        targetId: TASK,
        targetName: 'Fix login',
        metadata: { priority: 'HIGH', assigneeName: 'Max' },
      });
    });

    it('task.created records nothing without a response id', () => {
      expect(describe_('task.created', ctx())).toEqual([]);
    });

    it("task.updated lists changed fields (excluding assignment) and keeps a renamed task's old title", () => {
      const drafts = describe_(
        'task.updated',
        ctx({
          body: { title: 'New', priority: 'LOW' },
          response: { title: 'New' },
          before: { title: 'Old' },
        }),
      );
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        action: 'task.updated',
        targetName: 'New',
        metadata: { fields: ['title', 'priority'], previousTitle: 'Old' },
      });
    });

    it('task.updated turns an assignee change into its own task.assigned event', () => {
      const drafts = describe_(
        'task.updated',
        ctx({
          body: { assigneeId: USER, priority: 'LOW' },
          response: { title: 'T', assignee: { name: 'Max' } },
          before: { title: 'T', assigneeId: null },
        }),
      );
      expect(drafts.map((d) => d.action)).toEqual([
        'task.updated',
        'task.assigned',
      ]);
      expect(drafts[1].metadata).toEqual({
        assigneeId: USER,
        assigneeName: 'Max',
      });
    });

    it("task.updated records an unassignment using the previous assignee's name", () => {
      const drafts = describe_(
        'task.updated',
        ctx({
          body: { assigneeId: null },
          response: { title: 'T' },
          before: { title: 'T', assigneeId: USER, assigneeName: 'Max' },
        }),
      );
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        action: 'task.unassigned',
        metadata: { assigneeName: 'Max' },
      });
    });

    it('task.updated records nothing for an assignment that did not change', () => {
      const same = describe_(
        'task.updated',
        ctx({
          body: { assigneeId: USER },
          response: { title: 'T' },
          before: { assigneeId: USER },
        }),
      );
      expect(same).toEqual([]);
    });

    it('task.moved records a status change with the old and new column names', () => {
      const [draft] = describe_(
        'task.moved',
        ctx({
          body: { columnId: 'col-done', position: 0 },
          response: { title: 'Fix login' },
          before: {
            title: 'Fix login',
            columnId: 'col-todo',
            columnName: 'To Do',
            toColumnName: 'Done',
          },
        }),
      );
      expect(draft).toMatchObject({
        action: 'task.moved',
        targetName: 'Fix login',
        metadata: { from: 'To Do', to: 'Done' },
      });
    });

    it('task.moved ignores a reorder within the same column', () => {
      const drafts = describe_(
        'task.moved',
        ctx({
          body: { columnId: 'col-todo', position: 2 },
          before: {
            columnId: 'col-todo',
            columnName: 'To Do',
            toColumnName: 'To Do',
          },
        }),
      );
      expect(drafts).toEqual([]);
    });

    it('task.deleted keeps the title from the BEFORE snapshot (it is gone afterwards)', () => {
      const [draft] = describe_(
        'task.deleted',
        ctx({ before: { title: 'Fix login' } }),
      );
      expect(draft).toMatchObject({
        targetId: TASK,
        targetName: 'Fix login',
        taskId: TASK,
      });
    });

    it('task.labels_changed lists the new label names', () => {
      const [draft] = describe_(
        'task.labels_changed',
        ctx({
          response: {
            title: 'T',
            labels: [{ name: 'bug' }, { name: 'ui' }, {}],
          },
        }),
      );
      expect(draft.metadata).toEqual({ labels: ['bug', 'ui'] });
    });
  });

  describe('membership', () => {
    it('organization.member_role_changed records from and to, from the snapshot', () => {
      const [draft] = describe_(
        'organization.member_role_changed',
        ctx({
          body: { role: 'MANAGER' },
          before: { role: 'MEMBER', name: 'Max' },
        }),
      );
      expect(draft).toMatchObject({
        organizationId: ORG,
        targetType: 'user',
        targetId: USER,
        targetName: 'Max',
        metadata: { from: 'MEMBER', to: 'MANAGER' },
      });
      expect(draft.projectId).toBeUndefined();
    });

    it('a "role change" to the same role is not an event', () => {
      expect(
        describe_(
          'project.member_role_changed',
          ctx({ body: { role: 'LEAD' }, before: { role: 'LEAD' } }),
        ),
      ).toEqual([]);
    });

    it("project.member_removed keeps the removed person's name and role", () => {
      const [draft] = describe_(
        'project.member_removed',
        ctx({ before: { role: 'MEMBER', name: 'Max' } }),
      );
      expect(draft).toMatchObject({
        projectId: PROJECT,
        targetName: 'Max',
        metadata: { role: 'MEMBER' },
      });
    });

    it('organization.member_added reads the new member from the response', () => {
      const [draft] = describe_(
        'organization.member_added',
        ctx({ response: { role: 'MEMBER', user: { id: USER, name: 'Max' } } }),
      );
      expect(draft).toMatchObject({
        targetId: USER,
        targetName: 'Max',
        metadata: { role: 'MEMBER' },
      });
    });
  });

  describe('projects and organizations', () => {
    it('organization.created takes the tenant id from the RESPONSE (it did not exist before)', () => {
      const [draft] = describe_(
        'organization.created',
        ctx({ params: {}, response: { id: ORG, name: 'Acme' } }),
      );
      expect(draft).toMatchObject({
        organizationId: ORG,
        targetId: ORG,
        targetName: 'Acme',
      });
    });

    it('project.created uses the new project id as its own projectId', () => {
      const [draft] = describe_(
        'project.created',
        ctx({ params: { id: ORG }, response: { id: PROJECT, name: 'Apollo' } }),
      );
      expect(draft).toMatchObject({
        organizationId: ORG,
        projectId: PROJECT,
        targetName: 'Apollo',
      });
    });

    it('project.deleted keeps the name from the snapshot', () => {
      const [draft] = describe_(
        'project.deleted',
        ctx({ before: { name: 'Apollo' } }),
      );
      expect(draft).toMatchObject({ projectId: PROJECT, targetName: 'Apollo' });
    });
  });

  describe('comments and attachments', () => {
    it("are attached to their task's timeline and named after the task", () => {
      const [comment] = describe_(
        'comment.created',
        ctx({ response: { id: USER }, before: { title: 'Fix login' } }),
      );
      expect(comment).toMatchObject({
        taskId: TASK,
        targetType: 'comment',
        targetName: 'Fix login',
      });

      const [file] = describe_(
        'attachment.added',
        ctx({
          response: { id: USER, fileName: 'shot.png' },
          before: { title: 'Fix login' },
        }),
      );
      expect(file).toMatchObject({
        taskId: TASK,
        metadata: { fileName: 'shot.png' },
      });
    });
  });
});
