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

export interface Task {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeId: string | null;
  position: number;
  assignee: User | null;
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
