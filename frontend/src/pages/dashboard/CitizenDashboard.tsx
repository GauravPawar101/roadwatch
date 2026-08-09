import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useComplaints } from '../../hooks/useComplaints';
import { usePublicDashboard } from '../../hooks/usePublicDashboard';

function statusStyle(status: string) {
  if (status === 'Pending Audit' || status === 'Open') {
    return 'bg-status-pending text-status-pending-text border-status-pending-text/20';
  }
  if (status === 'Work Assigned' || status === 'InProgress') {
    return 'bg-secondary/10 text-secondary border-secondary/20';
  }
  if (status === 'Resolved') {
    return 'bg-status-resolved text-status-resolved-text border-status-resolved/20';
  }
  return 'bg-surface-container-low text-on-surface-variant border-outline-variant';
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function CitizenDashboard() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { complaints: reports, loading, error } = useComplaints({ limit: 10 });
  const { data: publicStats } = usePublicDashboard();

  const displayName = user?.username || user?.email?.split('@')[0] || 'there';
  const roadHealth = publicStats?.roadHealthIndex ?? null;

  return (
    <div className="min-h-screen bg-white text-on-background">
      <main className="container-max">
        {/* Hero */}
        <section className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="dashboard-chip">Citizen Portal</span>
              {isAuthenticated && (
                <span className="inline-flex items-center gap-1 text-caption font-medium text-on-tertiary-container">
                  <span className="material-symbols-outlined text-sm">verified</span>
                  Verified
                </span>
              )}
              {error && isAuthenticated && (
                <span className="inline-flex items-center gap-1 rounded-full bg-error-container px-2.5 py-0.5 text-caption text-error">
                  API unavailable
                </span>
              )}
            </div>
            <h1 className="text-headline-lg font-headline-lg tracking-tight text-on-surface">
              {isAuthenticated ? `Welcome back, ${displayName}` : 'Report road issues. Track repairs.'}
            </h1>
            <p className="mt-2 text-body-lg text-on-surface-variant">
              Monitor local road conditions, file grievances, and see how your reports drive real infrastructure action.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">
            <Link to="/map" className="btn-secondary !py-2.5">
              <span className="material-symbols-outlined text-lg">map</span>
              View Map
            </Link>
            <button onClick={() => navigate('/complaints/new')} className="btn-primary !py-2.5">
              <span className="material-symbols-outlined text-lg">add_circle</span>
              Report Issue
            </button>
          </div>
        </section>

        {/* Stats row */}
        <section className="card-grid mb-10">
          {[
            { label: 'Open Reports', value: reports.filter((r) => r.status !== 'Resolved').length, icon: 'pending_actions' },
            { label: 'High Severity', value: reports.filter((r) => r.severity >= 4).length, icon: 'warning' },
            { label: 'In Progress', value: reports.filter((r) => r.status === 'Work Assigned' || r.status === 'InProgress').length, icon: 'engineering' },
            { label: 'Road Health', value: roadHealth !== null ? String(roadHealth) : '—', icon: 'speed', suffix: roadHealth !== null ? '/100' : '' },
          ].map(({ label, value, icon, suffix }) => (
            <div key={label} className="stat-card">
              <div className="flex items-start justify-between">
                <p className="dashboard-caption">{label}</p>
                <span className="material-symbols-outlined text-xl text-secondary/40">{icon}</span>
              </div>
              <p className="dashboard-value mt-2">
                {value}
                {suffix && <span className="text-body-md font-normal text-on-surface-variant">{suffix}</span>}
              </p>
            </div>
          ))}
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Sidebar nav */}
          <aside className="lg:col-span-3">
            <div className="dashboard-card sticky top-24">
              <h3 className="dashboard-panel-title">Quick Links</h3>
              <nav className="flex flex-col gap-1">
                {[
                  { label: 'Overview', icon: 'dashboard', path: '/dashboard', active: true },
                  { label: 'Community Map', icon: 'map', path: '/map' },
                  { label: 'My Reports', icon: 'history', path: '/complaints' },
                  { label: 'Settings', icon: 'settings', path: '/settings' },
                ].map(({ label, icon, path, active }) => (
                  <button
                    key={label}
                    onClick={() => navigate(path)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-body-md transition-colors ${
                      active
                        ? 'bg-secondary/10 font-semibold text-secondary'
                        : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-xl">{icon}</span>
                    {label}
                  </button>
                ))}
              </nav>
            </div>
          </aside>

          {/* Reports list */}
          <section className="lg:col-span-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-headline-md font-headline-md tracking-tight">Recent Reports</h2>
              <button
                onClick={() => navigate('/complaints')}
                className="text-body-sm font-medium text-secondary transition-colors hover:text-primary"
              >
                View all →
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-outline-variant border-t-secondary" />
              </div>
            ) : !isAuthenticated ? (
              <div className="dashboard-card py-16 text-center">
                <span className="material-symbols-outlined mb-4 block text-5xl text-outline">lock</span>
                <p className="text-title-lg font-semibold text-on-surface">Sign in to view your reports</p>
                <p className="mt-1 text-body-md text-on-surface-variant">
                  Your complaint history is available after signing in.
                </p>
                <Link to="/auth/citizen/login" className="btn-primary mt-6 inline-flex">
                  Sign in
                </Link>
              </div>
            ) : reports.length === 0 ? (
              <div className="dashboard-card py-16 text-center">
                <span className="material-symbols-outlined mb-4 block text-5xl text-outline">add_road</span>
                <p className="text-title-lg font-semibold text-on-surface">No reports yet</p>
                <p className="mt-1 text-body-md text-on-surface-variant">
                  Be the first to report an issue in your area.
                </p>
                <button onClick={() => navigate('/complaints/new')} className="btn-primary mt-6">
                  File your first report
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {reports.map((report) => {
                  const isSevere = report.severity >= 4;
                  return (
                    <button
                      key={report.id}
                      onClick={() => navigate(`/complaints/${report.id}`)}
                      className={`dashboard-card group w-full text-left transition-all hover:shadow-md ${
                        isSevere ? 'border-l-4 border-l-error' : 'border-l-4 border-l-secondary'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className={`text-caption font-bold uppercase ${isSevere ? 'text-error' : 'text-secondary'}`}>
                              {isSevere ? 'High Priority' : 'Moderate'}
                            </span>
                            <span className="text-caption text-on-surface-variant">#{report.id}</span>
                            <span className="text-caption text-outline">· {timeAgo(report.createdAt)}</span>
                          </div>
                          <h3 className="text-title-lg font-semibold tracking-tight text-on-surface group-hover:text-secondary">
                            {report.title}
                          </h3>
                          <p className="mt-1 flex items-center gap-1 text-body-sm text-on-surface-variant">
                            <span className="material-symbols-outlined text-base">location_on</span>
                            <span className="truncate">{report.roadId}</span>
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-lg border px-2.5 py-1 text-caption font-semibold ${statusStyle(report.status)}`}>
                          {report.status}
                        </span>
                      </div>
                      <p className="mt-3 line-clamp-2 text-body-md text-on-surface-variant">{report.description}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Insights sidebar */}
          <aside className="flex flex-col gap-6 lg:col-span-3">
            <div className="dashboard-card text-center">
              <h3 className="dashboard-panel-title !mb-3">Local Road Health</h3>
              <div className="relative mx-auto mb-4 flex h-28 w-28 items-center justify-center">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 128 128">
                  <circle cx="64" cy="64" r="56" fill="transparent" stroke="var(--surface-container)" strokeWidth="8" />
                  <circle
                    cx="64" cy="64" r="56" fill="transparent"
                    stroke="url(#healthGrad)" strokeWidth="8"
                    strokeDasharray="351.9" strokeDashoffset="91"
                    strokeLinecap="round"
                  />
                  <defs>
                    <linearGradient id="healthGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#002045" />
                      <stop offset="100%" stopColor="#1960a3" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-headline-md font-bold leading-none">{roadHealth ?? '—'}</span>
                  <span className="text-caption text-on-surface-variant">/ 100</span>
                </div>
              </div>
              <p className="text-body-sm text-on-surface-variant">
                District: <span className="font-semibold text-on-surface">Pune Urban</span>
              </p>
              <div className="mt-3 inline-flex items-center gap-1 rounded-lg bg-surface-container-low px-3 py-1.5 text-caption font-semibold text-on-tertiary-container">
                <span className="material-symbols-outlined text-sm">trending_up</span>
                +4% this month
              </div>
            </div>

            <div className="dashboard-card">
              <h3 className="dashboard-panel-title">Your Impact</h3>
              <div className="space-y-4">
                {[
                  { value: '12', label: 'Issues resolved' },
                  { value: '450', label: 'Community upvotes' },
                  { value: 'Top 5%', label: 'Local contributor' },
                ].map(({ value, label }, i, arr) => (
                  <div key={label} className={i < arr.length - 1 ? 'border-b border-outline-variant/40 pb-4' : ''}>
                    <p className="text-headline-md font-bold leading-none text-on-surface">{value}</p>
                    <p className="mt-1 text-caption text-on-surface-variant">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {!isAuthenticated && (
              <div className="dashboard-card border-secondary/20 bg-secondary/5">
                <h3 className="text-title-lg font-semibold text-on-surface">Get started</h3>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  Sign in to file reports, track progress, and earn community karma.
                </p>
                <Link to="/auth/citizen/login" className="btn-primary mt-4 w-full justify-center">
                  Sign in as Citizen
                </Link>
              </div>
            )}
          </aside>
        </div>
      </main>

      <footer className="mt-16 border-t border-gray-200 bg-gray-50">
        <div className="container-max flex flex-col gap-8 py-10 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <p className="font-semibold text-on-surface">RoadWatch</p>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Transparent infrastructure grievance platform for citizens and authorities.
            </p>
          </div>
          <div className="flex gap-12">
            {[
              { heading: 'Platform', links: ['Open Data', 'API Docs', 'Status'] },
              { heading: 'Legal', links: ['Privacy', 'Terms', 'RTI'] },
            ].map(({ heading, links }) => (
              <div key={heading}>
                <p className="mb-2 text-caption font-semibold uppercase tracking-wider text-on-surface">{heading}</p>
                <ul className="space-y-1.5">
                  {links.map((l) => (
                    <li key={l}>
                      <a href="#" className="text-body-sm text-on-surface-variant transition-colors hover:text-secondary">{l}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-outline-variant/40 py-4 text-center text-caption text-on-surface-variant">
          © 2026 RoadWatch. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
