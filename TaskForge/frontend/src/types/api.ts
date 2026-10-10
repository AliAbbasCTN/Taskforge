/**
 * WHAT: TypeScript shapes of what the TaskForge backend sends and expects.
 *
 * WHY they're written by hand: the backend (NestJS DTOs and Prisma models)
 * and the frontend are separate programs, and the HTTP boundary between them
 * is not type-checked - the compiler can't see across a network. These types
 * are a PROMISE about the JSON on the wire. If the backend changes a field,
 * nothing here fails to compile; the UI just breaks at runtime. That is the
 * cost of a hand-written contract, and why Phase 16 (Swagger/OpenAPI) matters:
 * a machine-readable spec lets these types be generated instead.
 *
 * Dates arrive as ISO-8601 STRINGS (JSON has no Date type).
 */

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

export type MembershipRole = 'ADMIN' | 'MANAGER' | 'MEMBER';

/** An organization as seen by one user - including THEIR role in it. */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: MembershipRole;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';
export type ProjectRole = 'LEAD' | 'MEMBER';

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What list/detail reads return: a project plus two derived facts. */
export interface ProjectSummary extends Project {
  memberCount: number;
  /** null when you can see the project only via org ADMIN/MANAGER oversight. */
  currentUserRole: ProjectRole | null;
}

export interface ProjectMember {
  membershipId: string;
  role: ProjectRole;
  joinedAt: string;
  user: User;
}

export interface BoardSummary {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  _count: { columns: number };
}

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface Label {
  id: string;
  projectId: string;
  name: string;
  /** A "#RRGGBB" colour. */
  color: string;
}

export interface Task {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  assignee: User | null;
  labels: Label[];
}

/** A task as returned by the paginated list: it also says which column it is in. */
export interface ListedTask extends Task {
  column: { id: string; name: string };
}

/** The envelope every paginated endpoint returns. */
export interface Paginated<T> {
  items: T[];
  /** All matching rows across every page. */
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  createdAt: string;
  /** null until the comment is edited. */
  editedAt: string | null;
  /** null if the author's account was deleted. */
  author: User | null;
}

export interface BoardColumn {
  id: string;
  boardId: string;
  name: string;
  position: number;
  tasks: Task[];
}

/** The full board view: columns in order, each with its tasks in order. */
export interface BoardView {
  id: string;
  projectId: string;
  name: string;
  columns: BoardColumn[];
}

/** Shape of every error body the backend returns (see AllExceptionsFilter). */
export interface ApiErrorBody {
  statusCode: number;
  /** A string, or an array of strings for validation errors. */
  message: string | string[];
  error?: string;
}

export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'COMMENT_ADDED'
  | 'ADDED_TO_PROJECT';

/**
 * One item in the user's notification inbox. (Named `AppNotification` because
 * `Notification` is already a browser global - the desktop-notification API.)
 */
export interface AppNotification {
  id: string;
  type: NotificationType;
  /** The finished sentence, e.g. 'Ada assigned you "Fix login"'. */
  message: string;
  projectId: string;
  boardId: string | null;
  taskId: string | null;
  /** null = unread. */
  readAt: string | null;
  createdAt: string;
  actor: User | null;
  project: { id: string; name: string; organizationId: string };
}

export type ChangeResource =
  | 'project'
  | 'boards'
  | 'columns'
  | 'tasks'
  | 'labels'
  | 'comments';

/**
 * The payload of the server's `project:changed` socket event. It carries IDS
 * ONLY - never titles or content. It means "this changed, go and look"; the
 * client then re-reads the data over the normal authenticated HTTP API.
 */
export interface ProjectChangedEvent {
  resource: ChangeResource;
  projectId: string;
  boardId?: string;
  taskId?: string;
  /** Who made the change. */
  actorId?: string;
  at: string;
}
