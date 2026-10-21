import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';
import { ACTIVITY_ACTIONS } from '../../activity/activity.types';
import { UserResponse } from './identity.models';
import { TaskListItemResponse, TaskResponse } from './work.models';
import {
  EXAMPLE_BOARD_ID,
  EXAMPLE_COLUMN_ID,
  EXAMPLE_DATE,
  EXAMPLE_ORG_ID,
  EXAMPLE_PROJECT_ID,
  EXAMPLE_TASK_ID,
  EXAMPLE_USER_ID,
} from './examples';

const DATE_TIME = { type: String, format: 'date-time', example: EXAMPLE_DATE };

// -------------------------------------------------------------- pagination

/**
 * Every paginated route returns the same envelope: the page's `items` plus
 * enough numbers for a client to draw a pager. Each concrete page class below
 * only adds the typed `items` array.
 */
export class PaginationMeta {
  @ApiProperty({ example: 42, description: 'Matches across ALL pages.' })
  total!: number;

  @ApiProperty({ example: 1, description: '1-based.' })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({
    example: 3,
    description: 'At least 1, even when there are no results.',
  })
  totalPages!: number;
}

export class PaginatedTaskListResponse extends PaginationMeta {
  @ApiProperty({ type: () => [TaskListItemResponse] })
  items!: TaskListItemResponse[];
}

// ------------------------------------------------------------------ search

export class SearchColumnRef {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_COLUMN_ID })
  id!: string;

  @ApiProperty({ example: 'In Progress' })
  name!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_BOARD_ID })
  boardId!: string;
}

export class SearchResultResponse extends TaskResponse {
  @ApiProperty({ type: SearchColumnRef })
  column!: SearchColumnRef;

  @ApiProperty({
    example: 0.0607927,
    description: 'Relevance score. Higher is a better match.',
  })
  score!: number;

  @ApiProperty({
    example: 'Fix <mark>login</mark> redirect',
    description:
      'The title with matches wrapped in `<mark>` tags. Every other character is HTML-escaped by the server, so it is safe to render as HTML.',
  })
  titleHighlight!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Users cannot <mark>login</mark> after the redirect...',
    description: 'A highlighted excerpt of the description, or null if there is none.',
  })
  snippet!: string | null;
}

export class PaginatedSearchResponse extends PaginationMeta {
  @ApiProperty({ type: () => [SearchResultResponse] })
  items!: SearchResultResponse[];
}

// ----------------------------------------------------------- notifications

export class NotificationProjectRef {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_PROJECT_ID })
  id!: string;

  @ApiProperty({ example: 'Website relaunch' })
  name!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_ORG_ID })
  organizationId!: string;
}

export class NotificationResponse {
  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-0000-4000-8000-000000000003' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_USER_ID, description: 'The recipient (you).' })
  userId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: EXAMPLE_USER_ID })
  actorId!: string | null;

  @ApiProperty({
    enum: NotificationType,
    enumName: 'NotificationType',
    example: NotificationType.TASK_ASSIGNED,
  })
  type!: NotificationType;

  @ApiProperty({ example: 'Ada Lovelace assigned you "Fix login redirect"' })
  message!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_PROJECT_ID })
  projectId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: EXAMPLE_BOARD_ID })
  boardId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: EXAMPLE_TASK_ID })
  taskId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'Null while unread.',
  })
  readAt!: string | null;

  @ApiProperty(DATE_TIME)
  createdAt!: string;

  @ApiProperty({ type: UserResponse, nullable: true })
  actor!: UserResponse | null;

  @ApiProperty({ type: NotificationProjectRef })
  project!: NotificationProjectRef;
}

export class PaginatedNotificationResponse extends PaginationMeta {
  @ApiProperty({ type: () => [NotificationResponse] })
  items!: NotificationResponse[];
}

export class UnreadCountResponse {
  @ApiProperty({ example: 3 })
  count!: number;
}

export class MarkAllReadResponse {
  @ApiProperty({ example: 3, description: 'How many notifications were newly marked read.' })
  updated!: number;
}

// ---------------------------------------------------------------- activity

export class ActivityEntryResponse {
  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-0000-4000-8000-000000000004' })
  id!: string;

  @ApiProperty({ enum: [...ACTIVITY_ACTIONS], example: 'task.moved' })
  action!: string;

  @ApiProperty({
    example: 'Ada Lovelace moved "Fix login redirect" from To Do to Done',
    description: 'A human-readable sentence, built from the snapshot stored with the entry.',
  })
  message!: string;

  @ApiProperty({
    example: 'task',
    description: 'What kind of thing the action was done to.',
  })
  targetType!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: EXAMPLE_TASK_ID,
    description: 'Not a foreign key: it can refer to something since deleted.',
  })
  targetId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Fix login redirect',
    description: 'The target\'s name AT THE TIME of the action.',
  })
  targetName!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: EXAMPLE_PROJECT_ID })
  projectId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: EXAMPLE_TASK_ID })
  taskId!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { from: 'To Do', to: 'Done' },
    description: 'Action-specific details, such as the old and new value of a change.',
  })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: EXAMPLE_USER_ID,
    description: 'Null if the actor\'s account has since been deleted.',
  })
  actorId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Ada Lovelace',
    description: 'The actor\'s name AT THE TIME of the action.',
  })
  actorName!: string | null;

  @ApiProperty(DATE_TIME)
  createdAt!: string;
}

export class PaginatedActivityResponse extends PaginationMeta {
  @ApiProperty({ type: () => [ActivityEntryResponse], description: 'Newest first.' })
  items!: ActivityEntryResponse[];
}

// ------------------------------------------------------------------ health

export class HealthDependencies {
  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  database!: 'up' | 'down';

  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  redis!: 'up' | 'down';
}

export class QueueCountsResponse {
  @ApiProperty({ example: 0 })
  waiting!: number;

  @ApiProperty({ example: 0 })
  active!: number;

  @ApiProperty({ example: 0 })
  delayed!: number;

  @ApiProperty({ example: 0, description: 'Should normally be 0. A rising number means background work is failing.' })
  failed!: number;
}

export class HealthQueues {
  @ApiProperty({ type: QueueCountsResponse })
  notifications!: QueueCountsResponse;

  @ApiProperty({ type: QueueCountsResponse })
  maintenance!: QueueCountsResponse;
}

export class HealthResponse {
  @ApiProperty({
    enum: ['ok', 'degraded', 'error'],
    example: 'ok',
    description:
      '`ok`: everything reachable. `degraded`: Redis is down (HTTP 200 - the API still works). `error`: the database is down (HTTP 503).',
  })
  status!: 'ok' | 'degraded' | 'error';

  @ApiProperty({ example: 'development' })
  environment!: string;

  @ApiProperty({ type: HealthDependencies })
  dependencies!: HealthDependencies;

  @ApiProperty({
    type: HealthQueues,
    nullable: true,
    description: 'Job counts per queue; null when Redis cannot be reached.',
  })
  queues!: HealthQueues | null;

  @ApiProperty(DATE_TIME)
  timestamp!: string;
}
