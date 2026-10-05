import { apiRequest } from './http';
import type {
  AuthResponse,
  BoardSummary,
  BoardView,
  Organization,
  Project,
  ProjectMember,
  ProjectStatus,
  ProjectSummary,
  Task,
  User,
} from '../types/api';

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

  get: (orgId: string, projectId: string, boardId: string) =>
    apiRequest<BoardView>(`${boardsPath(orgId, projectId)}/${boardId}`),

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

export const taskApi = {
  create: (
    orgId: string,
    projectId: string,
    boardId: string,
    input: { columnId: string; title: string },
  ) =>
    apiRequest<Task>(`${boardsPath(orgId, projectId)}/${boardId}/tasks`, {
      method: 'POST',
      body: input,
    }),

  /** Moving a task to another column is how its status changes. */
  move: (
    orgId: string,
    projectId: string,
    boardId: string,
    taskId: string,
    columnId: string,
  ) =>
    apiRequest<Task>(
      `${boardsPath(orgId, projectId)}/${boardId}/tasks/${taskId}/move`,
      { method: 'POST', body: { columnId } },
    ),
};
