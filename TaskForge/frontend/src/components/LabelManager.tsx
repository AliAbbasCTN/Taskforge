import { useState, type FormEvent } from 'react';
import { useLabelActions, useLabels } from '../hooks/useLabels';
import { EmptyState, ErrorBox, FormError, Loading } from './Feedback';
import { LabelChip } from './LabelChip';

/**
 * WHAT: A project's labels - everyone on the project sees them; project leads
 * (and org admins/managers) can add and delete them. `canManage` is a UI hint
 * only; the server enforces `project:boards:manage` on every change.
 */
export function LabelManager({
  orgId,
  projectId,
  canManage,
}: {
  orgId: string;
  projectId: string;
  canManage: boolean;
}) {
  const labels = useLabels(orgId, projectId);
  const { create, remove } = useLabelActions(orgId, projectId);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#2f4bdb');

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await create.mutateAsync({ name: name.trim(), color });
      setName('');
    } catch {
      // Shown from `create.error` (for example: that name already exists).
    }
  }

  return (
    <section aria-labelledby="labels-heading">
      <h2 id="labels-heading">Labels</h2>

      {labels.isError && (
        <ErrorBox error={labels.error} onRetry={() => void labels.refetch()} />
      )}
      {labels.isPending && <Loading label="Loading labels" />}
      {labels.data?.length === 0 && (
        <EmptyState title="No labels yet.">
          {canManage
            ? 'Add one below, then tag tasks with it.'
            : 'A project lead can add labels.'}
        </EmptyState>
      )}

      {labels.data && labels.data.length > 0 && (
        <ul className="rows">
          {labels.data.map((label) => (
            <li key={label.id} className="row row-static">
              <LabelChip label={label} />
              <span className="row-main" />
              {canManage && (
                <button
                  type="button"
                  className="link-button"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete the label "${label.name}"? It will be removed from every task that has it.`,
                      )
                    ) {
                      remove.mutate(label.id);
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <FormError error={remove.error} />

      {canManage && (
        <form onSubmit={handleCreate} className="inline-form panel">
          <div className="field">
            <label htmlFor="label-name">New label</label>
            <input
              id="label-name"
              required
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field field-color">
            <label htmlFor="label-color">Colour</label>
            <input
              id="label-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={create.isPending}
          >
            {create.isPending ? 'Adding…' : 'Add label'}
          </button>
        </form>
      )}
      <FormError error={create.error} />
    </section>
  );
}
