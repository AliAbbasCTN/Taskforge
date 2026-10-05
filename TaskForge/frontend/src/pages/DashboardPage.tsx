import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, ErrorBox, FormError, Loading } from '../components/Feedback';
import { FormField } from '../components/FormField';
import { useAuth } from '../contexts/AuthContext';
import {
  useCreateOrganization,
  useOrganizations,
} from '../hooks/useOrganizations';

const ROLE_LABEL = { ADMIN: 'Admin', MANAGER: 'Manager', MEMBER: 'Member' };

/**
 * WHAT: The landing page after login - the organizations you belong to, and
 * a way to start a new one.
 *
 * Every organization here came from `GET /organizations`, which the backend
 * answers with ONLY the organizations the logged-in user is a member of
 * (tenant isolation, Phase 04). The UI doesn't filter anything itself.
 */
export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const organizations = useOrganizations();
  const createOrganization = useCreateOrganization();
  const [name, setName] = useState('');

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const organization = await createOrganization.mutateAsync(name.trim());
      setName('');
      navigate(`/orgs/${organization.id}`);
    } catch {
      // The error is displayed from `createOrganization.error` below.
    }
  }

  return (
    <>
      <header className="page-header">
        <h1>Welcome, {user?.name}</h1>
        <p>Pick an organization to see its projects.</p>
      </header>

      <section aria-labelledby="orgs-heading">
        <h2 id="orgs-heading">Your organizations</h2>

        {organizations.isError && (
          <ErrorBox
            error={organizations.error}
            onRetry={() => void organizations.refetch()}
          />
        )}
        {organizations.isPending && <Loading label="Loading organizations" />}

        {organizations.data?.length === 0 && (
          <EmptyState title="You're not in any organization yet.">
            Create one below to start adding projects.
          </EmptyState>
        )}

        {organizations.data && organizations.data.length > 0 && (
          <ul className="rows">
            {organizations.data.map((org) => (
              <li key={org.id}>
                <Link to={`/orgs/${org.id}`} className="row">
                  <span className="row-title">{org.name}</span>
                  <span className="tag">{ROLE_LABEL[org.role]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-org-heading" className="panel">
        <h2 id="new-org-heading">New organization</h2>
        <form onSubmit={handleCreate} className="inline-form">
          <FormField
            label="Name"
            required
            minLength={2}
            maxLength={150}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={createOrganization.isPending}
          >
            {createOrganization.isPending ? 'Creating…' : 'Create organization'}
          </button>
        </form>
        <FormError error={createOrganization.error} />
      </section>
    </>
  );
}
