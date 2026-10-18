import { useProjectActivity } from '../hooks/useActivity';
import { ActivityList } from './ActivityList';
import { EmptyState, ErrorBox, Loading } from './Feedback';

interface TaskActivityProps {
  orgId: string;
  projectId: string;
  taskId: string;
}

/** The latest events for ONE task: the project feed filtered by `taskId`. */
export function TaskActivity({ orgId, projectId, taskId }: TaskActivityProps) {
  const activity = useProjectActivity(orgId, projectId, {
    taskId,
    page: 1,
    pageSize: 10,
  });

  return (
    <section aria-labelledby="task-activity-heading" className="activity">
      <h3 id="task-activity-heading">Activity</h3>
      {activity.isError && (
        <ErrorBox error={activity.error} onRetry={() => void activity.refetch()} />
      )}
      {activity.isPending && <Loading label="Loading activity" />}
      {activity.data?.items.length === 0 && (
        <EmptyState title="No activity yet." />
      )}
      {activity.data && activity.data.items.length > 0 && (
        <>
          <ActivityList entries={activity.data.items} />
          {activity.data.total > activity.data.items.length && (
            <p className="muted">
              Showing the latest {activity.data.items.length} of{' '}
              {activity.data.total}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
