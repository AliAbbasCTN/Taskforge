import {
  ActivityDraft,
  LoggedActivityAction,
  ActivitySpec,
  DescribeContext,
  JsonObject,
} from './activity.types';

/**
 * WHAT: For every recordable action, a PURE function that turns "this request
 * just succeeded" into the activity entries to store.
 *
 * WHY pure functions in one table: the interceptor stays generic and tiny, and
 * the rules of "what do we record for a task move?" live here, readable top to
 * bottom and unit-testable with plain objects - no HTTP, no database. Adding an
 * event is one entry here plus one decorator on a controller method.
 *
 * Inputs are `unknown`-ish JSON (a request body, a response, a snapshot), so
 * everything is read defensively: a missing field yields "no entry" or a
 * missing name, never an exception. (And the interceptor treats a throwing
 * describer as "record nothing" - logging must never break the request.)
 */

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const record = (value: unknown): JsonObject =>
  typeof value === 'object' && value !== null ? (value as JsonObject) : {};

/** Names of the properties a client sent, e.g. `['title', 'priority']`. */
const fieldsOf = (body: JsonObject, exclude: string[] = []): string[] =>
  Object.keys(body).filter((key) => !exclude.includes(key));

const orgId = (c: DescribeContext) => c.params.id as string;

/** Shared by everything that happens inside a project. */
function inProject(c: DescribeContext) {
  return { organizationId: orgId(c), projectId: c.params.projectId };
}

/** Shared by everything that happens to one task (or its comments/files). */
function onTask(c: DescribeContext) {
  return { ...inProject(c), taskId: c.params.taskId };
}

export const ACTIVITY_SPECS: Record<LoggedActivityAction, ActivitySpec> = {
  // ---------------------------------------------------------------- organization
  'organization.created': {
    describe: (c) => {
      const id = text(c.response.id);
      return id
        ? [
            {
              organizationId: id,
              action: 'organization.created',
              targetType: 'organization',
              targetId: id,
              targetName: text(c.response.name),
            },
          ]
        : [];
    },
  },
  'organization.updated': {
    describe: (c) => [
      {
        organizationId: orgId(c),
        action: 'organization.updated',
        targetType: 'organization',
        targetId: orgId(c),
        targetName: text(c.response.name),
        metadata: { fields: fieldsOf(c.body) },
      },
    ],
  },
  'organization.member_added': memberAdded('organization.member_added', false),
  'organization.member_role_changed': memberRoleChanged(
    'organization.member_role_changed',
    false,
  ),
  'organization.member_removed': memberRemoved(
    'organization.member_removed',
    false,
  ),

  // --------------------------------------------------------------------- project
  'project.created': {
    describe: (c) => {
      const id = text(c.response.id);
      return id
        ? [
            {
              organizationId: orgId(c),
              projectId: id,
              action: 'project.created',
              targetType: 'project',
              targetId: id,
              targetName: text(c.response.name),
            },
          ]
        : [];
    },
  },
  'project.updated': {
    describe: (c) => [
      {
        ...inProject(c),
        action: 'project.updated',
        targetType: 'project',
        targetId: c.params.projectId,
        targetName: text(c.response.name),
        metadata: { fields: fieldsOf(c.body) },
      },
    ],
  },
  'project.archived': projectState('project.archived'),
  'project.unarchived': projectState('project.unarchived'),
  'project.deleted': {
    snapshot: 'project',
    describe: (c) => [
      {
        ...inProject(c),
        action: 'project.deleted',
        targetType: 'project',
        targetId: c.params.projectId,
        targetName: text(c.before?.name),
      },
    ],
  },
  'project.member_added': memberAdded('project.member_added', true),
  'project.member_role_changed': memberRoleChanged(
    'project.member_role_changed',
    true,
  ),
  'project.member_removed': memberRemoved('project.member_removed', true),

  // ----------------------------------------------------------------------- board
  'board.created': boardEvent('board.created'),
  'board.updated': boardEvent('board.updated'),
  'board.deleted': {
    snapshot: 'board',
    describe: (c) => [
      {
        ...inProject(c),
        action: 'board.deleted',
        targetType: 'board',
        targetId: c.params.boardId,
        targetName: text(c.before?.name),
      },
    ],
  },

  // ------------------------------------------------------------------------ task
  'task.created': {
    describe: (c) => {
      const id = text(c.response.id);
      if (!id) {
        return [];
      }
      return [
        {
          ...inProject(c),
          taskId: id,
          action: 'task.created',
          targetType: 'task',
          targetId: id,
          targetName: text(c.response.title),
          metadata: {
            priority: text(c.response.priority),
            assigneeName: text(record(c.response.assignee).name),
          },
        },
      ];
    },
  },
  'task.updated': {
    snapshot: 'task',
    describe: (c) => {
      const drafts: ActivityDraft[] = [];
      const base = {
        ...onTask(c),
        targetType: 'task' as const,
        targetId: c.params.taskId,
      };

      // Assignment is its own event: "assigned to Max" reads better in a feed
      // than "updated assigneeId", and people filter on it.
      const fields = fieldsOf(c.body, ['assigneeId']);
      if (fields.length > 0) {
        drafts.push({
          ...base,
          action: 'task.updated',
          targetName: text(c.response.title),
          metadata: {
            fields,
            // A rename is worth keeping the old title for.
            ...(fields.includes('title') && c.before?.title
              ? { previousTitle: text(c.before.title) }
              : {}),
          },
        });
      }

      if ('assigneeId' in c.body) {
        const newId = text(c.body.assigneeId);
        const oldId = text(c.before?.assigneeId);
        if (newId && newId !== oldId) {
          drafts.push({
            ...base,
            action: 'task.assigned',
            targetName: text(c.response.title),
            metadata: {
              assigneeId: newId,
              assigneeName: text(record(c.response.assignee).name),
            },
          });
        } else if (!newId && oldId) {
          drafts.push({
            ...base,
            action: 'task.unassigned',
            targetName: text(c.response.title),
            metadata: { assigneeName: text(c.before?.assigneeName) },
          });
        }
      }
      return drafts;
    },
  },
  'task.moved': {
    snapshot: 'task-move',
    describe: (c) => {
      // Reordering inside one column is not worth an entry; changing column is
      // a status change.
      if (!c.before || c.before.columnId === c.body.columnId) {
        return [];
      }
      return [
        {
          ...onTask(c),
          action: 'task.moved',
          targetType: 'task',
          targetId: c.params.taskId,
          targetName: text(c.response.title) ?? text(c.before.title),
          metadata: {
            from: text(c.before.columnName),
            to: text(c.before.toColumnName),
          },
        },
      ];
    },
  },
  'task.labels_changed': {
    describe: (c) => {
      const labels = Array.isArray(c.response.labels) ? c.response.labels : [];
      return [
        {
          ...onTask(c),
          action: 'task.labels_changed',
          targetType: 'task',
          targetId: c.params.taskId,
          targetName: text(c.response.title),
          metadata: {
            labels: labels
              .map((label) => text(record(label).name))
              .filter((name): name is string => name !== undefined),
          },
        },
      ];
    },
  },
  'task.deleted': {
    snapshot: 'task',
    describe: (c) => [
      {
        ...onTask(c),
        action: 'task.deleted',
        targetType: 'task',
        targetId: c.params.taskId,
        targetName: text(c.before?.title),
      },
    ],
  },

  // --------------------------------------------------------- comments & attachments
  'comment.created': {
    snapshot: 'task',
    describe: (c) => [
      {
        ...onTask(c),
        action: 'comment.created',
        targetType: 'comment',
        targetId: text(c.response.id),
        // The name of a comment target is the TASK it is on - that is what the
        // sentence needs: "commented on task X".
        targetName: text(c.before?.title),
      },
    ],
  },
  'comment.deleted': {
    snapshot: 'task',
    describe: (c) => [
      {
        ...onTask(c),
        action: 'comment.deleted',
        targetType: 'comment',
        targetId: c.params.commentId,
        targetName: text(c.before?.title),
      },
    ],
  },
  'attachment.added': {
    snapshot: 'task',
    describe: (c) => [
      {
        ...onTask(c),
        action: 'attachment.added',
        targetType: 'attachment',
        targetId: text(c.response.id),
        targetName: text(c.before?.title),
        metadata: { fileName: text(c.response.fileName) },
      },
    ],
  },
  'attachment.removed': {
    snapshot: 'attachment',
    describe: (c) => [
      {
        ...onTask(c),
        action: 'attachment.removed',
        targetType: 'attachment',
        targetId: c.params.attachmentId,
        targetName: text(c.before?.taskTitle),
        metadata: { fileName: text(c.before?.fileName) },
      },
    ],
  },
};

// ------------------------------------------------------------------ shared builders

function projectState(
  action: 'project.archived' | 'project.unarchived',
): ActivitySpec {
  return {
    describe: (c) => [
      {
        ...inProject(c),
        action,
        targetType: 'project',
        targetId: c.params.projectId,
        targetName: text(c.response.name),
      },
    ],
  };
}

function boardEvent(action: 'board.created' | 'board.updated'): ActivitySpec {
  return {
    describe: (c) => {
      const id = text(c.response.id) ?? c.params.boardId;
      return id
        ? [
            {
              ...inProject(c),
              action,
              targetType: 'board',
              targetId: id,
              targetName: text(c.response.name),
            },
          ]
        : [];
    },
  };
}

/** Organization or project membership, depending on `inAProject`. */
function memberAdded(
  action: 'organization.member_added' | 'project.member_added',
  inAProject: boolean,
): ActivitySpec {
  return {
    describe: (c) => {
      const user = record(c.response.user);
      return [
        {
          ...(inAProject ? inProject(c) : { organizationId: orgId(c) }),
          action,
          targetType: 'user',
          targetId: text(user.id),
          targetName: text(user.name),
          metadata: { role: text(c.response.role) },
        },
      ];
    },
  };
}

function memberRoleChanged(
  action: 'organization.member_role_changed' | 'project.member_role_changed',
  inAProject: boolean,
): ActivitySpec {
  return {
    snapshot: inAProject ? 'project-member' : 'org-member',
    describe: (c) => {
      const from = text(c.before?.role);
      const to = text(c.body.role);
      if (from && from === to) {
        return [];
      }
      return [
        {
          ...(inAProject ? inProject(c) : { organizationId: orgId(c) }),
          action,
          targetType: 'user',
          targetId: c.params.userId,
          targetName: text(c.before?.name),
          metadata: { from, to },
        },
      ];
    },
  };
}

function memberRemoved(
  action: 'organization.member_removed' | 'project.member_removed',
  inAProject: boolean,
): ActivitySpec {
  return {
    snapshot: inAProject ? 'project-member' : 'org-member',
    describe: (c) => [
      {
        ...(inAProject ? inProject(c) : { organizationId: orgId(c) }),
        action,
        targetType: 'user',
        targetId: c.params.userId,
        targetName: text(c.before?.name),
        metadata: { role: text(c.before?.role) },
      },
    ],
  };
}
