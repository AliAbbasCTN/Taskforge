import { ActivityAction, JsonObject } from './activity.types';

/** The parts of a stored entry that its sentence is built from. */
export interface MessageSource {
  action: string;
  targetName?: string | null;
  metadata?: unknown;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  dueDate: 'due date',
  name: 'name',
};

const quote = (name: string | null | undefined) =>
  name ? `“${name}”` : 'an item';

const meta = (source: MessageSource): JsonObject =>
  typeof source.metadata === 'object' && source.metadata !== null
    ? (source.metadata as JsonObject)
    : {};

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const roleWord = (role: unknown) => asText(role)?.toLowerCase();

function fieldList(metadata: JsonObject): string {
  const fields = Array.isArray(metadata.fields) ? metadata.fields : [];
  const labels = fields
    .filter((f): f is string => typeof f === 'string')
    .map((f) => FIELD_LABELS[f] ?? f);
  return labels.length > 0 ? ` (${labels.join(', ')})` : '';
}

/**
 * WHAT: Turns a stored entry into the sentence shown in the feed, WITHOUT the
 * actor: the UI puts the person's name in front, giving "Lena Lead moved task
 * “Fix login” from To Do to Done".
 *
 * WHY built when READ, not stored: the database keeps structured facts (action,
 * target, metadata) and wording is a presentation concern. Reworded sentences,
 * or a second language, then apply to the whole history at once instead of
 * needing a data migration. An unknown action (say, one written by a newer
 * version of the app) falls back to a generic sentence rather than failing.
 *
 * Pure function - the table of sentences is unit-tested directly.
 */
export function formatActivityMessage(source: MessageSource): string {
  const m = meta(source);
  const name = quote(source.targetName);
  const action = source.action as ActivityAction;

  switch (action) {
    case 'organization.created':
      return `created the organization ${name}`;
    case 'organization.updated':
      return `updated the organization settings${fieldList(m)}`;
    case 'organization.member_added':
      return `added ${source.targetName ?? 'a member'} to the organization as ${roleWord(m.role) ?? 'a member'}`;
    case 'organization.member_role_changed':
      return `changed ${source.targetName ?? 'a member'}’s organization role from ${roleWord(m.from) ?? 'unknown'} to ${roleWord(m.to) ?? 'unknown'}`;
    case 'organization.member_removed':
      return `removed ${source.targetName ?? 'a member'} from the organization`;

    case 'project.created':
      return `created project ${name}`;
    case 'project.updated':
      return `updated project ${name}${fieldList(m)}`;
    case 'project.archived':
      return `archived project ${name}`;
    case 'project.unarchived':
      return `unarchived project ${name}`;
    case 'project.deleted':
      return `deleted project ${name}`;
    case 'project.member_added':
      return `added ${source.targetName ?? 'a member'} to the project as ${roleWord(m.role) ?? 'a member'}`;
    case 'project.member_role_changed':
      return `changed ${source.targetName ?? 'a member'}’s project role from ${roleWord(m.from) ?? 'unknown'} to ${roleWord(m.to) ?? 'unknown'}`;
    case 'project.member_removed':
      return `removed ${source.targetName ?? 'a member'} from the project`;

    case 'board.created':
      return `created board ${name}`;
    case 'board.updated':
      return `updated board ${name}`;
    case 'board.deleted':
      return `deleted board ${name}`;

    case 'task.created':
      return `created task ${name}`;
    case 'task.updated': {
      const previous = asText(m.previousTitle);
      return `updated task ${name}${fieldList(m)}${previous ? `, previously ${quote(previous)}` : ''}`;
    }
    case 'task.assigned':
      return `assigned task ${name} to ${asText(m.assigneeName) ?? 'someone'}`;
    case 'task.unassigned':
      return `unassigned ${asText(m.assigneeName) ?? 'the assignee'} from task ${name}`;
    case 'task.moved':
      return `moved task ${name} from ${asText(m.from) ?? 'a column'} to ${asText(m.to) ?? 'another column'}`;
    case 'task.labels_changed': {
      const labels = Array.isArray(m.labels) ? m.labels.join(', ') : '';
      return `changed the labels on task ${name} (${labels || 'none'})`;
    }
    case 'task.deleted':
      return `deleted task ${name}`;

    case 'comment.created':
      return `commented on task ${name}`;
    case 'comment.deleted':
      return `deleted a comment on task ${name}`;
    case 'attachment.added':
      return `attached ${asText(m.fileName) ?? 'a file'} to task ${name}`;
    case 'attachment.removed':
      return `removed ${asText(m.fileName) ?? 'a file'} from task ${name}`;

    default:
      return `performed ${source.action}`;
  }
}
