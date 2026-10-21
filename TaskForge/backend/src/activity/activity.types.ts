/**
 * Every kind of event TaskForge records. A TypeScript union (not a database
 * enum) so adding an event never needs a migration - but a typo is still a
 * compile error, and the list drives request validation (`?action=`).
 */
export const ACTIVITY_ACTIONS = [
  'organization.created',
  'organization.updated',
  'organization.member_added',
  'organization.member_role_changed',
  'organization.member_removed',
  'project.created',
  'project.updated',
  'project.archived',
  'project.unarchived',
  'project.deleted',
  'project.member_added',
  'project.member_role_changed',
  'project.member_removed',
  'board.created',
  'board.updated',
  'board.deleted',
  'task.created',
  'task.updated',
  'task.assigned',
  'task.unassigned',
  'task.moved',
  'task.labels_changed',
  'task.deleted',
  'comment.created',
  'comment.deleted',
  'attachment.added',
  'attachment.removed',
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/**
 * Actions that are never attached to a route directly: they are DERIVED from
 * another action's request (a `task.updated` PATCH that changes the assignee
 * also yields `task.assigned`). They are valid stored/filterable actions but
 * have no spec of their own.
 */
export type DerivedActivityAction = 'task.assigned' | 'task.unassigned';

/** Actions a controller method can declare with `@LogsActivity`. */
export type LoggedActivityAction = Exclude<ActivityAction, DerivedActivityAction>;

export type ActivityTargetType =
  | 'organization'
  | 'project'
  | 'board'
  | 'task'
  | 'comment'
  | 'attachment'
  | 'user';

export type JsonObject = Record<string, unknown>;

/** What a describer returns: one event, minus who did it (added later). */
export interface ActivityDraft {
  organizationId: string;
  projectId?: string | null;
  taskId?: string | null;
  action: ActivityAction;
  targetType: ActivityTargetType;
  targetId?: string | null;
  targetName?: string | null;
  metadata?: JsonObject;
}

/** What `ActivityService.record` stores: a draft plus who did it. */
export interface ActivityEntryInput extends ActivityDraft {
  actorId: string;
}

/**
 * Which "before" snapshot the interceptor must load BEFORE the request runs.
 * Needed when the answer is gone afterwards (a deleted task's title) or when
 * the event is about a CHANGE ("moved from To Do to Done" needs the old column).
 */
export type SnapshotKind =
  | 'task'
  | 'task-move'
  | 'project'
  | 'board'
  | 'org-member'
  | 'project-member'
  | 'attachment';

/** What a describer can see of the request that just succeeded. */
export interface DescribeContext {
  params: Record<string, string | undefined>;
  body: JsonObject;
  /** What the handler returned (undefined for 204 responses). */
  response: JsonObject;
  /** The snapshot taken before the request, if the action asked for one. */
  before: JsonObject | null;
}

export interface ActivitySpec {
  snapshot?: SnapshotKind;
  describe(context: DescribeContext): ActivityDraft[];
}
