import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorBox, Loading } from '../components/Feedback';
import { Highlighted } from '../components/Highlighted';
import { LabelChip } from '../components/LabelChip';
import { Pagination } from '../components/Pagination';
import { useProject } from '../hooks/useProjects';
import { useTaskSearch } from '../hooks/useSearch';
import type { TaskSearchParams } from '../services/api';
import type { TaskPriority } from '../types/api';
import { PRIORITIES } from '../utils/filters';

const SORT_OPTIONS: { value: TaskSearchParams['sortBy']; label: string }[] = [
  { value: 'relevance', label: 'Best match' },
  { value: 'createdAt', label: 'Newest first' },
  { value: 'dueDate', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title (A-Z)' },
];
const PAGE_SIZE = 10;

/** Reads a number from the URL, falling back (the URL is untrusted input). */
function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

/**
 * WHAT: Search a project's tasks: type words, optionally narrow by priority /
 * overdue, choose how to sort, page through results.
 *
 * WHY the state lives in the URL (`?q=login&priority=HIGH&page=2`): a search
 * result page can be bookmarked or shared, and the back button steps through
 * previous searches. The text box itself keeps a local "draft" so typing is
 * instant; pressing Enter (or Search) commits the draft to the URL, which is
 * what actually triggers the request.
 *
 * Ordering is done by the DATABASE (PostgreSQL full-text ranking), not the
 * browser - results are paginated, so the browser only ever holds one page.
 */
export default function SearchPage() {
  const { orgId = '', projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const project = useProject(orgId, projectId);

  const q = searchParams.get('q') ?? '';
  const priorityParam = searchParams.get('priority');
  const priority = (PRIORITIES as readonly string[]).includes(priorityParam ?? '')
    ? (priorityParam as TaskPriority)
    : undefined;
  const overdue = searchParams.get('overdue') === 'true' ? true : undefined;
  const sortParam = searchParams.get('sortBy');
  const sortBy =
    SORT_OPTIONS.find((option) => option.value === sortParam)?.value ??
    'relevance';
  const page = positiveInt(searchParams.get('page'), 1);

  const [draft, setDraft] = useState(q);
  // Keep the box in step when the URL changes (back/forward buttons).
  useEffect(() => setDraft(q), [q]);

  const params: TaskSearchParams = {
    q,
    page,
    pageSize: PAGE_SIZE,
    sortBy,
    sortOrder: sortBy === 'title' ? 'asc' : 'desc',
    priority,
    overdue,
  };
  const results = useTaskSearch(orgId, projectId, params);

  /** Changes URL parameters; any change except paging goes back to page 1. */
  function update(changes: Record<string, string | undefined>, resetPage = true) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    if (resetPage) {
      next.delete('page');
    }
    setSearchParams(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update({ q: draft.trim() });
  }

  const projectPath = `/orgs/${orgId}/projects/${projectId}`;

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={projectPath}>{project.data?.name ?? 'Project'}</Link>
      </nav>

      <header className="page-header">
        <h1>Search tasks</h1>
      </header>

      <form className="search-form" role="search" onSubmit={handleSubmit}>
        <div className="field grow">
          <label htmlFor="search-q">Search titles and descriptions</label>
          <input
            id="search-q"
            type="search"
            value={draft}
            maxLength={100}
            placeholder='e.g. login "password reset" -email'
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={draft.trim() === ''}>
          Search
        </button>
      </form>

      <div className="filters">
        <div className="field">
          <label htmlFor="search-priority">Priority</label>
          <select
            id="search-priority"
            value={priority ?? ''}
            onChange={(event) => update({ priority: event.target.value })}
          >
            <option value="">Any</option>
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0) + value.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="search-sort">Sort by</label>
          <select
            id="search-sort"
            value={sortBy}
            onChange={(event) => update({ sortBy: event.target.value })}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={overdue ?? false}
            onChange={(event) =>
              update({ overdue: event.target.checked ? 'true' : undefined })
            }
          />
          Overdue only
        </label>
      </div>

      {q === '' && (
        <EmptyState title="Search this project's tasks.">
          Words are matched by meaning, not letter-for-letter: "running" finds
          "run". Use "quotes" for an exact phrase and a minus sign to exclude a
          word.
        </EmptyState>
      )}
      {q !== '' && results.isError && (
        <ErrorBox error={results.error} onRetry={() => void results.refetch()} />
      )}
      {q !== '' && results.isPending && <Loading label="Searching" />}
      {results.data?.items.length === 0 && (
        <EmptyState title={`No tasks match "${q}".`}>
          Try fewer or different words, or clear a filter.
        </EmptyState>
      )}

      {results.data && results.data.items.length > 0 && (
        <>
          <ul className="search-results">
            {results.data.items.map((task) => (
              <li key={task.id} className="search-result">
                <Link
                  className="search-result-title"
                  to={`${projectPath}/boards/${task.column.boardId}/tasks/${task.id}`}
                >
                  <Highlighted text={task.titleHighlight} />
                </Link>
                {task.snippet && (
                  <p className="search-snippet">
                    <Highlighted text={task.snippet} />
                  </p>
                )}
                <p className="muted search-meta">
                  <span>{task.column.name}</span>
                  <span>{task.priority.charAt(0) + task.priority.slice(1).toLowerCase()}</span>
                  {task.assignee && <span>{task.assignee.name}</span>}
                  {task.labels.map((label) => (
                    <LabelChip key={label.id} label={label} />
                  ))}
                </p>
              </li>
            ))}
          </ul>
          <Pagination
            page={results.data.page}
            totalPages={results.data.totalPages}
            total={results.data.total}
            itemLabel="result"
            onPageChange={(next) => update({ page: String(next) }, false)}
          />
        </>
      )}
    </>
  );
}
