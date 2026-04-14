import React from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { clearAuth, getToken, getUser } from './auth';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { BudgetPage } from './pages/BudgetPage';
import { ComplaintQueuePage } from './pages/ComplaintQueuePage';
import { LoginPage } from './pages/LoginPage';
import { MapViewPage } from './pages/MapViewPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PublicDashboardPage } from './pages/PublicDashboardPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const user = getUser<any>();
  return (
    <>
      <div className="nav">
        <NavLink to="/queue">Complaint Queue</NavLink>
        <NavLink to="/map">Map View</NavLink>
        <NavLink to="/analytics">Analytics</NavLink>
        <NavLink to="/budget">Budget</NavLink>
        {user?.role === 'CE' ? <NavLink to="/admin/users">Admin</NavLink> : null}
        {user?.role === 'CE' ? <NavLink to="/audit">Audit Log</NavLink> : null}
        <NavLink to="/notifications">Notifications</NavLink>
        <div className="spacer" />
        <span className="muted">{user?.role ?? ''} {user?.phone ?? ''}</span>
        <button
          className="secondary"
          onClick={() => {
            clearAuth();
            navigate('/login');
          }}
        >
          Sign out
        </button>
      </div>
      <div className="container">{children}</div>
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/public" element={<PublicDashboardPage />} />
      <Route
        path="/queue"
        element={
          <RequireAuth>
            <Layout>
              <ComplaintQueuePage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/map"
        element={
          <RequireAuth>
            <Layout>
              <MapViewPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/analytics"
        element={
          <RequireAuth>
            <Layout>
              <AnalyticsPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/budget"
        element={
          <RequireAuth>
            <Layout>
              <BudgetPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/audit"
        element={
          <RequireAuth>
            <Layout>
              <AuditLogPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/users"
        element={
          <RequireAuth>
            <Layout>
              <AdminUsersPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/notifications"
        element={
          <RequireAuth>
            <Layout>
              <NotificationsPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route path="/" element={<Navigate to="/queue" replace />} />
      <Route path="*" element={<Navigate to="/queue" replace />} />
    </Routes>
  );
}
