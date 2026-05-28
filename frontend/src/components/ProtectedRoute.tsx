import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, type Role } from '../contexts/AuthContext';
import { Alert, Spinner } from './UIComponents';

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRoles?: Role[];
  requireFabricVerified?: boolean;
}

/**
 * Route guard component that protects routes requiring authentication
 */
export function ProtectedRoute({
  children,
  requiredRoles,
  requireFabricVerified = false
}: ProtectedRouteProps) {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Spinner />
      </div>
    );
  }

  const location = useLocation()

  if (!isAuthenticated || !user) {
    // Redirect to role-appropriate login page when not authenticated
    let loginPath = '/auth/citizen/login';
    if (requiredRoles) {
      if (requiredRoles.includes('CONTRACTOR')) loginPath = '/auth/contractor/login';
      else if (requiredRoles.includes('CE') || requiredRoles.includes('EE')) loginPath = '/auth/authority/login';
    }
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`${loginPath}?next=${next}`} replace />;
  }

  if (requiredRoles && !requiredRoles.includes(user.role)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Alert variant="error">You do not have permission to access this page.</Alert>
      </div>
    );
  }

  if (requireFabricVerified && !user.fabricVerified) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Alert variant="error">Your Fabric identity is not verified. Contact administrator.</Alert>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Route guard for authority-only pages (CE, EE roles)
 */
export function AuthorityGuard({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute requiredRoles={['CE', 'EE']} requireFabricVerified={true}>
      {children}
    </ProtectedRoute>
  );
}

/**
 * Route guard for contractor-only pages
 */
export function ContractorGuard({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute requiredRoles={['CONTRACTOR']} requireFabricVerified={true}>
      {children}
    </ProtectedRoute>
  );
}

/**
 * Route guard for citizen-only pages
 */
export function CitizenGuard({ children }: { children: ReactNode }) {
  return <ProtectedRoute requiredRoles={['CITIZEN']}>{children}</ProtectedRoute>;
}
