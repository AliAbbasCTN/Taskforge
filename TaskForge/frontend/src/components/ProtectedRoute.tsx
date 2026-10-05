import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Loading } from './Feedback';

interface LocationState {
  from?: { pathname: string };
}

/**
 * WHAT: A route wrapper: renders its child routes only for logged-in users,
 * and sends everyone else to /login (remembering where they were headed).
 *
 * !! This is a convenience, NOT security. !! Route protection only decides
 * which SCREEN to show. Anyone can read this code in their browser and bypass
 * it. What actually protects data is that the backend refuses every API
 * request without a valid token (and the right permissions, Phases 03-08).
 */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <Loading label="Checking your session" />;
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

/**
 * The reverse: login and register pages are for logged-OUT users. A logged-in
 * user who opens /login is sent on to where they were originally headed.
 */
export function PublicOnlyRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <Loading label="Checking your session" />;
  }
  if (status === 'authenticated') {
    const from = (location.state as LocationState | null)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }
  return <Outlet />;
}
