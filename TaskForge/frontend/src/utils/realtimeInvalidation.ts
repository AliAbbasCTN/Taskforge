import type { QueryKey } from '@tanstack/react-query';
import type { ProjectChangedEvent } from '../types/api';

/**
 * WHAT: Decides which cached data is out of date after a `project:changed`
 * event - i.e. which queries to refetch.
 *
 * This is the heart of "invalidation-based" real-time: the event does not
 * carry the new data, only WHAT KIND of thing changed and where. We mark the
 * matching cached queries stale and TanStack Query refetches the ones that are
 * currently on screen, over normal authenticated HTTP.
 *
 * It errs on the side of refetching too much rather than too little: a wasted
 * refetch costs a request, a missed one leaves someone looking at stale data.
 * Where the event is missing an id (it shouldn't be) it falls back to the
 * broader key prefix, which invalidates every entry under it.
 *
 * Query keys used elsewhere: ['board', boardId, filters], ['tasks', boardId, params],
 * ['task', taskId], ['comments', taskId], ['labels', orgId, projectId],
 * ['project', orgId, projectId], ['projects', orgId, status], ['boards', orgId, projectId].
 */
export function queryKeysForChange(event: ProjectChangedEvent): QueryKey[] {
  const board: QueryKey = event.boardId ? ['board', event.boardId] : ['board'];
  const taskList: QueryKey = event.boardId ? ['tasks', event.boardId] : ['tasks'];
  const task: QueryKey = event.taskId ? ['task', event.taskId] : ['task'];

  switch (event.resource) {
    case 'tasks':
      return [board, taskList, task];
    case 'columns':
      return [board, taskList];
    case 'boards':
      // The board list on the project page, and the board itself.
      return [['boards'], board, taskList];
    case 'comments':
      return [event.taskId ? ['comments', event.taskId] : ['comments']];
    case 'labels':
      // Labels appear on every task, and in the label pickers.
      return [['labels'], board, taskList, ['task']];
    case 'project':
      // Name, archived state, membership.
      return [['project'], ['projects'], ['project-members'], ['boards']];
  }
}
