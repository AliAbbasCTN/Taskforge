import { apiRequest } from './http';
import type {
  AppNotification,
  AuthResponse,
  BoardSummary,
  BoardView,
  Comment,
  Label,
  ListedTask,
  Organization,
  Paginated,
  Project,
  ProjectMember,
  ProjectStatus,
  ProjectSummary,
  Task,
  TaskPriority,
  User,
} from '../types/api';
import { filtersToQuery, type TaskFilters } from '../utils/filters';

/**
 * WHAT: One typed function per backend endpoint, grouped by resource.
 *
 * WHY a separate layer instead of calling `fetch` inside components: URLs and
 * request shapes live in ONE place, so when an endpoint changes there is one
 * file to update; components stay focused on what to show; and this layer is
 * easy to test or swap. Components never see URLs.
 */

export const authApi = {
  register: (input: { name: string; email: string; password: string }) =>
    apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: input,
      skipAuth: true,
    }),

  login: (input: { email: string; password: string }) =>
    apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: input,
      skipAuth: true,
    }),

  logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),

  me: () => apiRequest<User>('/auth/me'),
};

export const organizationApi = {
  list: () => apiRequest<Organization[]>('/organizations'),

  create: (name: string) =>
    apiRequest<Organization>('/organizations', {
      method: 'POST',
      body: { name },
    }),
};

const projectsPath = (orgId: string) => `/organizations/${orgId}/projects`;

export const projectApi = {
  list: (orgId: string, status: ProjectStatus) =>
    apiRequest<ProjectSummary[]>(`${projectsPath(orgId)}?status=${status}`),

  get: (orgId: string, projectId: string) =>
    apiRequest<ProjectSummary>(`${projectsPath(orgId)}/${projectId}`),

  create: (orgId: string, input: { name: string; description?: string }) =>
    apiRequest<Project>(projectsPath(orgId), { method: 'POST', body: input }),

  archive: (orgId: string, projectId: string) =>
    apiRequest<Project>(`${projectsPath(orgId)}/${projectId}/archive`, {
      method: 'POST',
    }),

  unarchive: (orgId: string, projectId: string) =>
    apiRequest<Project>(`${projectsPath(orgId)}/${projectId}/unarchive`, {
      method: 'POST',
    }),

  remove: (orgId: string, projectId: string) =>
    apiRequest<void>(`${projectsPath(orgId)}/${projectId}`, {
      method: 'DELETE',
    }),

  members: (orgId: string, projectId: string) =>
    apiRequest<ProjectMember[]>(`${projectsPath(orgId)}/${projectId}/members`),
};

const boardsPath = (orgId: string, projectId: string) =>
  `${projectsPath(orgId)}/${projectId}/boards`;

export const boardApi = {
  list: (orgId: string, projectId: string) =>
    apiRequest<BoardSummary[]>(boardsPath(orgId, projectId)),

  /** The board view, optionally with only the tasks matching `filters`. */
  get: (
    orgId: string,
    projectId: string,
    boardId: string,
    filters: TaskFilters = {},
  ) => {
    const query = filtersToQuery(filters);
    return apiRequest<BoardView>(
      `${boardsPath(orgId, projectId)}/${boardId}${query ? `?${query}` : ''}`,
    );
  },

  create: (orgId: string, projectId: string, name: string) =>
    apiRequest<{ id: string; name: string }>(boardsPath(orgId, projectId), {
      method: 'POST',
      body: { name },
    }),

  createColumn: (
    orgId: string,
    projectId: string,
    boardId: string,
    name: string,
  ) =>
    apiRequest<{ id: string }>(
      `${boardsPath(orgId, projectId)}/${boardId}/columns`,
      { method: 'POST', body: { name } },
    ),
};

export interface TaskListParams extends TaskFilters {
  page: number;
  pageSize: number;
  sortBy: 'createdAt' | 'dueDate' | 'priority' | 'title';
  sortOrder: 'asc' | 'desc';
}

export interface TaskUpdate {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  assigneeId?: string | null;
}

const tasksPath = (orgId: string, projectId: string, boardId: string) =>
  `${boardsPath(orgId, projectId)}/${boardId}/tasks`;

export const taskApi = {
  /** The paginated, sortable, filterable task list. */
  list: (
    orgId: string,
    projectId: string,
    boardId: string,
    params: TaskListParams,
  ) => {
    const { page, pageSize, sortBy, sortOrder, ...filters } = params;
    const query = new URLSearchParams(filtersToQuery(filters));
    query.set('page', String(page));
    query.set('pageSize', String(pageSize));
    query.set('sortBy', sortBy);
    query.set('sortOrder', sortOrder);
    return apiRequest<Paginated<ListedTask>>(
      `${tasksPath(orgId, projectId, boardId)}?${query.toString()}`,
    );
  },

  get: (orgId: string, projectId: string, boardId: string, taskId: string) =>
    apiRequest<Task>(`${tasksPath(orgId, projectId, boardId)}/${taskId}`),

  create: (
    orgId: string,
    projectId: string,
    boardId: string,
    input: { columnId: string; title: string },
  ) =>
    apiRequest<Task>(tasksPath(orgId, projectId, boardId), {
      method: 'POST',
      body: input,
    }),

  update: (
    orgId: string,
    projectId: string,
    boardId: string,
    taskId: string,
    input: TaskUpdate,
  ) =>
    apiRequest<Task>(`${tasksPath(orgId, projectId, boardId)}/${taskId}`, {
      method: 'PATCH',
      body: input,
    }),

  /** Replaces the task's labels with exactly `labelIds`. */
  setLabels: (
    orgId: string,
    projectId: string,
    boardId: string,
    taskId: string,
    labelIds: string[],
  ) =>
    apiRequest<Task>(
      `${tasksPath(orgId, projectId, boardId)}/${taskId}/labels`,
      { method: 'PUT', body: { labelIds } },
    ),

  /** Moving a task to another column is how its status changes. */
  move: (
    orgId: string,
    projectId: string,
    boardId: string,
    taskId: string,
    columnId: string,
    position?: number,
  ) =>
    apiRequest<Task>(
      `${tasksPath(orgId, projectId, boardId)}/${taskId}/move`,
      { method: 'POST', body: { columnId, position } },
    ),

  remove: (orgId: string, projectId: string, boardId: string, taskId: string) =>
    apiRequest<void>(`${tasksPath(orgId, projectId, boardId)}/${taskId}`, {
      method: 'DELETE',
    }),
};

const labelsPath = (orgId: string, projectId: string) =>
  `${projectsPath(orgId)}/${projectId}/labels`;

export const labelApi = {
  list: (orgId: string, projectId: string) =>
    apiRequest<Label[]>(labelsPath(orgId, projectId)),

  create: (
    orgId: string,
    projectId: string,
    input: { name: string; color: string },
  ) =>
    apiRequest<Label>(labelsPath(orgId, projectId), {
      method: 'POST',
      body: input,
    }),

  remove: (orgId: string, projectId: string, labelId: string) =>
    apiRequest<void>(`${labelsPath(orgId, projectId)}/${labelId}`, {
      method: 'DELETE',
    }),
};

const commentsPath = (
  orgId: string,
  projectId: string,
  boardId: string,
  taskId: string,
) => `${tasksPath(orgId, projectId, boardId)}/${taskId}/comments`;

export const commentApi = {
  list: (orgId: string, projectId: string, boardId: string, taskId: string) =>
    apiRequest<Comment[]>(commentsPath(orgId, projectId, boardId, taskId)),

  create: (
    orgId: string,
    projectId: string,
    boardId: string,
    taskId: string,
    body: string,
  ) =>
    apiRequest<Comment>(commentsPath(orgId, projectId, boardId, taskId), {
      method: 'POST',
      body: { body },
    }),

  update: (
    orgId: string,
    projectId: string,
    boardId: string,
    taskId: string,
    commentId: string,
    body: string,
  ) =>
    apiRequest<Comment>(
      `${commentsPath(orgId, projectId, boardId, taskId)}/${commentId}`,
      { method: 'PATCH', body: { body } },
    ),

  remove: (
    orgId: string,
    projectId: string,
    boardId: string,
    taskId: string,
    commentId: string,
  ) =>
    apiRequest<void>(
      `${commentsPath(orgId, projectId, boardId, taskId)}/${commentId}`,
      { method: 'DELETE' },
    ),
};

export const notificationApi = {
  list: (params: { page: number; pageSize: number; unreadOnly: boolean }) => {
    const query = new URLSearchParams({
      page: String(params.page),
      pageSize: String(params.pageSize),
    });
    if (params.unreadOnly) {
      query.set('unread', 'true');
    }
    return apiRequest<Paginated<AppNotification>>(
      `/notifications?${query.toString()}`,
    );
  },

  unreadCount: () =>
    apiRequest<{ count: number }>('/notifications/unread-count'),

  markRead: (id: string) =>
    apiRequest<AppNotification>(`/notifications/${id}/read`, { method: 'POST' }),

  markAllRead: () =>
    apiRequest<{ updated: number }>('/notifications/read-all', {
      method: 'POST',
    }),
};
