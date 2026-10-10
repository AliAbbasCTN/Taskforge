interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  /** What is being counted, singular. Defaults to "task". */
  itemLabel?: string;
  onPageChange: (page: number) => void;
}

/** Previous / next controls plus "Page 2 of 5". */
export function Pagination({
  page,
  totalPages,
  total,
  itemLabel = 'task',
  onPageChange,
}: PaginationProps) {
  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="btn"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span aria-live="polite">
        Page {page} of {totalPages}{' '}
        <span className="muted">({total} {total === 1 ? itemLabel : `${itemLabel}s`})</span>
      </span>
      <button
        type="button"
        className="btn"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
