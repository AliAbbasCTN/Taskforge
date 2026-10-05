import { type ChangeEvent } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useOrganizations } from '../hooks/useOrganizations';
import { initialOf } from '../utils/format';

/**
 * WHAT: The frame around every logged-in page: a sidebar (organization
 * switcher, navigation, current user) beside the page content.
 *
 * ORGANIZATION SWITCHING: the "current organization" is not stored in any
 * state - it is whatever `/orgs/:orgId` says in the URL. Switching is just
 * navigating. That means the browser's back button, bookmarks and shared
 * links all work for free, and there is no second copy of "which org am I in"
 * that could disagree with the URL. `useMatch` reads it here because this
 * layout sits ABOVE the route that declares `:orgId`, so `useParams` would
 * not see it.
 */
export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const organizations = useOrganizations();
  const orgMatch = useMatch('/orgs/:orgId/*');
  const currentOrgId = orgMatch?.params.orgId ?? '';

  function handleOrgChange(event: ChangeEvent<HTMLSelectElement>) {
    const orgId = event.target.value;
    if (orgId) {
      navigate(`/orgs/${orgId}`);
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            T
          </span>
          TaskForge
        </Link>

        <div className="field">
          <label htmlFor="org-switcher">Organization</label>
          <select
            id="org-switcher"
            value={currentOrgId}
            onChange={handleOrgChange}
            disabled={!organizations.data?.length}
          >
            <option value="">
              {organizations.isPending ? 'Loading…' : 'Choose organization'}
            </option>
            {organizations.data?.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>

        <nav aria-label="Main">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
        </nav>

        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">
            {initialOf(user?.name ?? '')}
          </span>
          <div className="sidebar-user-text">
            <span className="sidebar-user-name">{user?.name}</span>
            <button
              type="button"
              className="link-button"
              onClick={() => void logout()}
            >
              Log out
            </button>
          </div>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
