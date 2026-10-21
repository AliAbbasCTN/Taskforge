import { ApiProperty } from '@nestjs/swagger';
import { ProjectRole, ProjectStatus, TaskPriority } from '@prisma/client';
import { UserResponse } from './identity.models';
import {
  EXAMPLE_BOARD_ID,
  EXAMPLE_COLUMN_ID,
  EXAMPLE_DATE,
  EXAMPLE_LABEL_ID,
  EXAMPLE_MEMBERSHIP_ID,
  EXAMPLE_ORG_ID,
  EXAMPLE_PROJECT_ID,
  EXAMPLE_TASK_ID,
  EXAMPLE_USER_ID,
} from './examples';

const DATE_TIME = { type: String, format: 'date-time', example: EXAMPLE_DATE };

// ---------------------------------------------------------------- projects

export class ProjectResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_PROJECT_ID })
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_ORG_ID })
  organizationId!: string;

  @ApiProperty({ example: 'Website relaunch' })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Rebuild the marketing site.',
  })
  description!: string | null;

  @ApiProperty({
    enum: ProjectStatus,
    enumName: 'ProjectStatus',
    example: ProjectStatus.ACTIVE,
    description: 'An ARCHIVED project is read-only until unarchived.',
  })
  status!: ProjectStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  archivedAt!: string | null;

  @ApiProperty(DATE_TIME)
  createdAt!: string;

  @ApiProperty(DATE_TIME)
  updatedAt!: string;
}

export class ProjectSummaryResponse extends ProjectResponse {
  @ApiProperty({ example: 4, description: 'Number of project members.' })
  memberCount!: number;

  @ApiProperty({
    enum: ProjectRole,
    enumName: 'ProjectRole',
    nullable: true,
    example: ProjectRole.LEAD,
    description:
      'YOUR role on the project, or null if you can see it only through organization-wide oversight (ADMIN/MANAGER).',
  })
  currentUserRole!: ProjectRole | null;
}

export class ProjectMemberResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_MEMBERSHIP_ID })
  membershipId!: string;

  @ApiProperty({
    enum: ProjectRole,
    enumName: 'ProjectRole',
    example: ProjectRole.MEMBER,
  })
  role!: ProjectRole;

  @ApiProperty(DATE_TIME)
  joinedAt!: string;

  @ApiProperty({ type: UserResponse })
  user!: UserResponse;
}

// ------------------------------------------------------- boards and columns

export class ColumnResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_COLUMN_ID })
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_BOARD_ID })
  boardId!: string;

  @ApiProperty({ example: 'In Progress' })
  name!: string;

  @ApiProperty({ example: 1, description: 'Zero-based position on the board.' })
  position!: number;

  @ApiProperty(DATE_TIME)
  createdAt!: string;

  @ApiProperty(DATE_TIME)
  updatedAt!: string;
}

export class BoardResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_BOARD_ID })
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_PROJECT_ID })
  projectId!: string;

  @ApiProperty({ example: 'Sprint 12' })
  name!: string;

  @ApiProperty(DATE_TIME)
  createdAt!: string;

  @ApiProperty(DATE_TIME)
  updatedAt!: string;
}

export class BoardWithColumnsResponse extends BoardResponse {
  @ApiProperty({ type: () => [ColumnResponse], description: 'In board order.' })
  columns!: ColumnResponse[];
}

export class BoardColumnCount {
  @ApiProperty({ example: 3 })
  columns!: number;
}

export class BoardSummaryResponse extends BoardResponse {
  @ApiProperty({ type: BoardColumnCount })
  _count!: BoardColumnCount;
}

// ------------------------------------------------------------------ labels

export class LabelResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_LABEL_ID })
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_PROJECT_ID })
  projectId!: string;

  @ApiProperty({ example: 'Bug' })
  name!: string;

  @ApiProperty({ example: '#e03131', description: 'Hex colour, `#RRGGBB`.' })
  color!: string;

  @ApiProperty(DATE_TIME)
  createdAt!: string;

  @ApiProperty(DATE_TIME)
  updatedAt!: string;
}

// ------------------------------------------------------------------- tasks

export class TaskResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_TASK_ID })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    example: EXAMPLE_COLUMN_ID,
    description: 'The column the task is in - its status.',
  })
  columnId!: string;

  @ApiProperty({ example: 'Fix login redirect' })
  title!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Users land on a blank page.' })
  description!: string | null;

  @ApiProperty({
    enum: TaskPriority,
    enumName: 'TaskPriority',
    example: TaskPriority.HIGH,
  })
  priority!: TaskPriority;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-11-01T00:00:00.000Z' })
  dueDate!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: EXAMPLE_USER_ID })
  assigneeId!: string | null;

  @ApiProperty({ example: 0, description: 'Zero-based position within the column.' })
  position!: number;

  @ApiProperty({ type: UserResponse, nullable: true })
  assignee!: UserResponse | null;

  @ApiProperty({ type: () => [LabelResponse], description: 'Sorted by name.' })
  labels!: LabelResponse[];

  @ApiProperty(DATE_TIME)
  createdAt!: string;

  @ApiProperty(DATE_TIME)
  updatedAt!: string;
}

export class TaskColumnRef {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_COLUMN_ID })
  id!: string;

  @ApiProperty({ example: 'In Progress' })
  name!: string;
}

export class TaskListItemResponse extends TaskResponse {
  @ApiProperty({ type: TaskColumnRef })
  column!: TaskColumnRef;
}

export class ColumnWithTasksResponse extends ColumnResponse {
  @ApiProperty({
    type: () => [TaskResponse],
    description: 'In position order, after applying any task filters.',
  })
  tasks!: TaskResponse[];
}

export class BoardDetailResponse extends BoardResponse {
  @ApiProperty({ type: () => [ColumnWithTasksResponse] })
  columns!: ColumnWithTasksResponse[];
}

// ---------------------------------------------------------------- comments

export class CommentResponse {
  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-0000-4000-8000-000000000001' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_TASK_ID })
  taskId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: EXAMPLE_USER_ID,
    description: 'Null if the author has since deleted their account.',
  })
  authorId!: string | null;

  @ApiProperty({ example: 'Reproduced on Safari too.', description: 'Plain text, never HTML.' })
  body!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  editedAt!: string | null;

  @ApiProperty({ type: UserResponse, nullable: true })
  author!: UserResponse | null;

  @ApiProperty(DATE_TIME)
  createdAt!: string;

  @ApiProperty(DATE_TIME)
  updatedAt!: string;
}

// ------------------------------------------------------------- attachments

export class AttachmentResponse {
  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-0000-4000-8000-000000000002' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_TASK_ID })
  taskId!: string;

  @ApiProperty({ example: 'screenshot.png', description: 'The sanitised original name.' })
  fileName!: string;

  @ApiProperty({
    example: 'image/png',
    description: 'Determined by the server from the file CONTENT, not the client header.',
  })
  mimeType!: string;

  @ApiProperty({ example: 48213 })
  sizeBytes!: number;

  @ApiProperty({ type: UserResponse, nullable: true })
  uploader!: UserResponse | null;

  @ApiProperty(DATE_TIME)
  createdAt!: string;
}
