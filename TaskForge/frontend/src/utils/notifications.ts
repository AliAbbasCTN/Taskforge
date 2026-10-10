import type { AppNotification } from '../types/api';

/**
 * Where clicking a notification should go: the task if it points at one,
 * otherwise the project. (A task or board that has since been deleted simply
 * leads to a "not found" page - notifications deliberately outlive them.)
 */
export function notificationPath(notification: AppNotification): string {
  const project = `/orgs/${notification.project.organizationId}/projects/${notification.projectId}`;
  if (notification.boardId && notification.taskId) {
    return `${project}/boards/${notification.boardId}/tasks/${notification.taskId}`;
  }
  return project;
}
