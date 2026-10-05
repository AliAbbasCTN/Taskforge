import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorBox, FormError, Loading } from '../components/Feedback';
import { FormField } from '../components/FormField';
import { useOrganization } from '../hooks/useOrganizations';
import { useCreateProject, useProjects } from '../hooks/useProjects';
import type { ProjectStatus } from '../types/api';

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * WHAT: One organization's projects, with a switch between active and
 * archived, and a form to create a new project.
 *
 * `useParams` reads `:orgId` from the URL. Note what is NOT here: no check
 * that you may see this organization. If you aren't a member, the backend
 * answers 404 and the page shows that error. The URL is untrusted input.
 */
export default function OrganizationPage() {
  const { orgId = '' } = useParams();
  const { organization, isError: orgsFailed, error: orgsError } =
    useOrganization(orgId);
  const [status, setStatus] = useState<ProjectStatus>('ACTIVE');
  const projects = useProjects(orgId, status);
  const createProject = useCreateProject(orgId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await createProject.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setName('');
      setDescription('');
      setStatus('ACTIVE');
    } catch {
      // Displayed from `createProject.error` below.
    }
  }

  if (orgsFailed) {
    return <ErrorBox error={orgsError} />;
  }

  return (
    <>
      <header className="page-header">
        <h1>{organization?.name ?? 'Organization'}</h1>
        {organization && <p>You are {organization.role === 'ADMIN' ? 'an admin' : `a ${organization.role.toLowerCase()}`} here.</p>}
      </header>

      <section aria-labelledby="projects-heading">
        <div className="section-bar">
          <h2 id="projects-heading">Projects</h2>
          <div className="segmented" role="group" aria-label="Project status">
            {(['ACTIVE', 'ARCHIVED'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={status === option}
                className={status === option ? 'segment is-active' : 'segment'}
                onClick={() => setStatus(option)}
              >
                {option === 'ACTIVE' ? 'Active' : 'Archived'}
              </button>
            ))}
          </div>
        </div>

        {projects.isError && (
          <ErrorBox
            error={projects.error}
            onRetry={() => void projects.refetch()}
          />
        )}
        {projects.isPending && <Loading label="Loading projects" />}

        {projects.data?.length === 0 && (
          <EmptyState
            title={
              status === 'ACTIVE'
                ? 'No projects you can see yet.'
                : 'No archived projects.'
            }
          >
            {status === 'ACTIVE'
              ? 'Projects are private to their members. Create one below, or ask a project lead to add you.'
              : 'Archived projects appear here.'}
          </EmptyState>
        )}

        {projects.data && projects.data.length > 0 && (
          <ul className="rows">
            {projects.data.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/orgs/${orgId}/projects/${project.id}`}
                  className="row"
                >
                  <span className="row-main">
                    <span className="row-title">{project.name}</span>
                    {project.description && (
                      <span className="row-sub">{project.description}</span>
                    )}
                  </span>
                  <span className="row-side">
                    {project.currentUserRole === 'LEAD' && (
                      <span className="tag">Lead</span>
                    )}
                    <span className="muted">
                      {plural(project.memberCount, 'member')}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-project-heading" className="panel">
        <h2 id="new-project-heading">New project</h2>
        <form onSubmit={handleCreate} className="stack">
          <FormField
            label="Name"
            required
            minLength={2}
            maxLength={150}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <FormField
            label="Description"
            maxLength={2000}
            hint="Optional. What is this project for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <FormError error={createProject.error} />
          <div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createProject.isPending}
            >
              {createProject.isPending ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
