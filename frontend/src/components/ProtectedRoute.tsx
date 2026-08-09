import { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth, type Role } from '../contexts/AuthContext';
import { getDashboardPath } from '../lib/authRedirect';
import { Alert, Spinner } from './UIComponents';

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRoles?: Role[];
  requireFabricVerified?: boolean;
}

export function ProtectedRoute({
  children,
  requiredRoles,
  requireFabricVerified = false,
}: ProtectedRouteProps) {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    let loginPath = '/auth/citizen/login';
    if (requiredRoles?.includes('CONTRACTOR')) loginPath = '/auth/contractor/login';
    else if (requiredRoles?.some((r) => r === 'CE' || r === 'EE')) loginPath = '/auth/authority/login';

    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`${loginPath}?next=${next}`} state={{ from: location }} />;
  }

  if (requiredRoles && !requiredRoles.includes(user.role)) {
    return (
      <div className="container-max flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Alert variant="error">You do not have permission to access this page.</Alert>
        <Link to={getDashboardPath(user.role)} className="btn-primary">
          Go to your dashboard
        </Link>
      </div>
    );
  }

  if (requireFabricVerified && !user.fabricVerified) {
    return (
      <div className="container-max flex min-h-[60vh] items-center justify-center">
        <Alert variant="error">Your Fabric identity is not verified. Contact administrator.</Alert>
      </div>
    );
  }

  return <>{children}</>;
}

export function AuthorityGuard({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute requiredRoles={['CE', 'EE']}>
      {children}
    </ProtectedRoute>
  );
}

export function ContractorGuard({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute requiredRoles={['CONTRACTOR']}>
      {children}
    </ProtectedRoute>
  );
}

export function CitizenGuard({ children }: { children: ReactNode }) {
  return <ProtectedRoute requiredRoles={['CITIZEN']}>{children}</ProtectedRoute>;
}

/** Redirect already-authenticated users away from login pages */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (isAuthenticated && user) {
    const params = new URLSearchParams(location.search);
    const next = params.get('next');
    const target = next && next.startsWith('/') && !next.startsWith('/auth/')
      ? next
      : getDashboardPath(user.role);
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
}
