import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ActivityList } from '../components/ActivityList';
import { EmptyState, ErrorBox, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { useAuditLog } from '../hooks/useActivity';
import { ACTIVITY_ACTION_GROUPS } from '../utils/activity';

/**
 * WHAT: The organization audit trail: every recorded action across all
 * projects, plus membership and settings changes. Admins only - for anyone
 * else the server answers 403 and the error is shown here (the link to this
 * page is also only offered to admins, but hiding a link is a convenience;
 * the SERVER enforces access).
 *
 * Filters: action and a date range. The date inputs give `YYYY-MM-DD`; the
 * server treats a bare `to` date as the START of that day, so we send the END
 * of the day to include the whole last day.
 */
export default function AuditLogPage() {
  const { orgId = '' } = useParams();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const audit = useAuditLog(orgId, {
    page,
    pageSize: 20,
    action: action || undefined,
    from: from || undefined,
    to: to ? `${to}T23:59:59.999Z` : undefined,
  });

  /** Changing a filter returns to the first page. */
  const filter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={`/orgs/${orgId}`}>Organization</Link>
      </nav>

      <header className="page-header">
        <h1>Audit log</h1>
        <p>A permanent record of who did what. Entries can't be edited or deleted.</p>
      </header>

      <div className="filters">
        <div className="field">
          <label htmlFor="audit-action">Action</label>
          <select
            id="audit-action"
            value={action}
            onChange={(event) => filter(() => setAction(event.target.value))}
          >
            <option value="">All actions</option>
            {ACTIVITY_ACTION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.actions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="audit-from">From</label>
          <input
            id="audit-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => filter(() => setFrom(event.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="audit-to">To</label>
          <input
            id="audit-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => filter(() => setTo(event.target.value))}
          />
        </div>
      </div>

      {audit.isError && (
        <ErrorBox error={audit.error} onRetry={() => void audit.refetch()} />
      )}
      {audit.isPending && <Loading label="Loading the audit log" />}
      {audit.data?.items.length === 0 && (
        <EmptyState title="No matching activity.">
          Try a different action or date range.
        </EmptyState>
      )}
      {audit.data && audit.data.items.length > 0 && (
        <>
          <ActivityList entries={audit.data.items} />
          <Pagination
            page={audit.data.page}
            totalPages={audit.data.totalPages}
            total={audit.data.total}
            itemLabel="event"
            onPageChange={setPage}
          />
        </>
      )}
    </>
  );
}
