import type { ReactNode } from 'react';
import { getErrorMessage } from '../utils/errors';

/** Shown while data is on its way. `role="status"` lets screen readers announce it. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}…
    </div>
  );
}

/** Says what went wrong, and offers a retry when there is one to offer. */
export function ErrorBox({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <div className="state state-error" role="alert">
      <p>{getErrorMessage(error)}</p>
      {onRetry && (
        <button type="button" className="btn btn-quiet" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** An empty list is an invitation to act, so it always says what to do next. */
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {children && <p>{children}</p>}
    </div>
  );
}

/** An inline form error. Hidden entirely when there is nothing to say. */
export function FormError({ error }: { error: unknown }) {
  if (!error) {
    return null;
  }
  return (
    <p className="form-error" role="alert">
      {getErrorMessage(error)}
    </p>
  );
}
