import type { Label, ProjectMember, TaskPriority } from '../types/api';
import { PRIORITIES, hasActiveFilters, type TaskFilters } from '../utils/filters';

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

interface TaskFiltersProps {
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  members: ProjectMember[];
  labels: Label[];
}

/**
 * WHAT: The filter bar. It is a "controlled" component with no state of its
 * own: it shows whatever `filters` says and reports every change upward. The
 * page keeps the filters in the URL, so this component never needs to know.
 *
 * The filtering itself happens on the SERVER (the filters become query
 * parameters). Filtering in the browser would only ever see what has already
 * been downloaded, which stops being the whole list the moment results are
 * paginated.
 */
export function TaskFilterBar({
  filters,
  onChange,
  members,
  labels,
}: TaskFiltersProps) {
  return (
    <form
      className="filters"
      aria-label="Filter tasks"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="field">
        <label htmlFor="filter-priority">Priority</label>
        <select
          id="filter-priority"
          value={filters.priority ?? ''}
          onChange={(e) =>
            onChange({
              ...filters,
              priority: (e.target.value || undefined) as TaskPriority | undefined,
            })
          }
        >
          <option value="">Any</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABEL[priority]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="filter-assignee">Assignee</label>
        <select
          id="filter-assignee"
          value={filters.assigneeId ?? ''}
          onChange={(e) =>
            onChange({ ...filters, assigneeId: e.target.value || undefined })
          }
        >
          <option value="">Anyone</option>
          {members.map((member) => (
            <option key={member.user.id} value={member.user.id}>
              {member.user.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="filter-label">Label</label>
        <select
          id="filter-label"
          value={filters.labelId ?? ''}
          onChange={(e) =>
            onChange({ ...filters, labelId: e.target.value || undefined })
          }
        >
          <option value="">Any</option>
          {labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={filters.overdue ?? false}
          onChange={(e) =>
            onChange({ ...filters, overdue: e.target.checked || undefined })
          }
        />
        Overdue only
      </label>

      {hasActiveFilters(filters) && (
        <button type="button" className="btn btn-quiet" onClick={() => onChange({})}>
          Clear filters
        </button>
      )}
    </form>
  );
}
