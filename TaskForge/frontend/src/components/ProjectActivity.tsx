import { useState } from 'react';
import { useProjectActivity } from '../hooks/useActivity';
import { ActivityList } from './ActivityList';
import { EmptyState, ErrorBox, Loading } from './Feedback';
import { Pagination } from './Pagination';

interface ProjectActivityProps {
  orgId: string;
  projectId: string;
}

/** The project's recent activity, newest first, with paging. */
export function ProjectActivity({ orgId, projectId }: ProjectActivityProps) {
  const [page, setPage] = useState(1);
  const activity = useProjectActivity(orgId, projectId, { page, pageSize: 10 });

  return (
    <section aria-labelledby="project-activity-heading" className="activity">
      <h2 id="project-activity-heading">Recent activity</h2>
      {activity.isError && (
        <ErrorBox error={activity.error} onRetry={() => void activity.refetch()} />
      )}
      {activity.isPending && <Loading label="Loading activity" />}
      {activity.data?.items.length === 0 && (
        <EmptyState title="Nothing has happened here yet." />
      )}
      {activity.data && activity.data.items.length > 0 && (
        <>
          <ActivityList entries={activity.data.items} />
          <Pagination
            page={activity.data.page}
            totalPages={activity.data.totalPages}
            total={activity.data.total}
            itemLabel="event"
            onPageChange={setPage}
          />
        </>
      )}
    </section>
  );
}
