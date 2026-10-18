/**
 * The actions the audit-trail filter offers, grouped for the dropdown. Values
 * mirror ACTIVITY_ACTIONS on the server; a value the server doesn't know is
 * rejected with a clear 400, so a typo here can't silently return nothing.
 */
export const ACTIVITY_ACTION_GROUPS: {
  label: string;
  actions: { value: string; label: string }[];
}[] = [
  {
    label: 'Tasks',
    actions: [
      { value: 'task.created', label: 'Task created' },
      { value: 'task.updated', label: 'Task edited' },
      { value: 'task.assigned', label: 'Task assigned' },
      { value: 'task.unassigned', label: 'Task unassigned' },
      { value: 'task.moved', label: 'Task moved' },
      { value: 'task.labels_changed', label: 'Labels changed' },
      { value: 'task.deleted', label: 'Task deleted' },
      { value: 'comment.created', label: 'Comment added' },
      { value: 'comment.deleted', label: 'Comment deleted' },
      { value: 'attachment.added', label: 'File attached' },
      { value: 'attachment.removed', label: 'File removed' },
    ],
  },
  {
    label: 'Projects and boards',
    actions: [
      { value: 'project.created', label: 'Project created' },
      { value: 'project.updated', label: 'Project edited' },
      { value: 'project.archived', label: 'Project archived' },
      { value: 'project.unarchived', label: 'Project unarchived' },
      { value: 'project.deleted', label: 'Project deleted' },
      { value: 'project.member_added', label: 'Project member added' },
      { value: 'project.member_role_changed', label: 'Project role changed' },
      { value: 'project.member_removed', label: 'Project member removed' },
      { value: 'board.created', label: 'Board created' },
      { value: 'board.updated', label: 'Board edited' },
      { value: 'board.deleted', label: 'Board deleted' },
    ],
  },
  {
    label: 'Organization',
    actions: [
      { value: 'organization.created', label: 'Organization created' },
      { value: 'organization.updated', label: 'Settings changed' },
      { value: 'organization.member_added', label: 'Member added' },
      { value: 'organization.member_role_changed', label: 'Role changed' },
      { value: 'organization.member_removed', label: 'Member removed' },
    ],
  },
];

/** What to call someone whose account no longer exists and has no saved name. */
export const FORMER_MEMBER = 'Former member';
