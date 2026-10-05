import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute, PublicOnlyRoute } from './components/ProtectedRoute';
import { AppLayout } from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import OrganizationPage from './pages/OrganizationPage';
import ProjectPage from './pages/ProjectPage';
import BoardPage from './pages/BoardPage';
import NotFoundPage from './pages/NotFoundPage';

/**
 * WHAT: The route table - which URL shows which page.
 *
 * Routes nest. `<Route element={<ProtectedRoute />}>` has no path of its own:
 * it is a wrapper that guards everything inside it, and `<AppLayout />`
 * inside that supplies the sidebar. Each page renders into the layout's
 * `<Outlet />`.
 *
 *   /login, /register                 public (logged-out users only)
 *   /                                 dashboard: your organizations
 *   /orgs/:orgId                      an organization's projects
 *   /orgs/:orgId/projects/:projectId  a project and its boards
 *   /orgs/:orgId/projects/:projectId/boards/:boardId   the kanban board
 */
export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="orgs/:orgId" element={<OrganizationPage />} />
          <Route
            path="orgs/:orgId/projects/:projectId"
            element={<ProjectPage />}
          />
          <Route
            path="orgs/:orgId/projects/:projectId/boards/:boardId"
            element={<BoardPage />}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
