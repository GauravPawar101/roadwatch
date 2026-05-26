import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { listRecords } from '../../lib/offlineStore';

interface Report {
  id: string;
  roadId: string;
  title: string;
  damageType: string;
  severity: number;
  status: string;
  description: string;
  createdAt: string;
  location?: { lat?: number; lng?: number };
  media?: { ipfs?: string; sha?: string; filename?: string } | null;
}

export default function CitizenDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listRecords<Report>('complaints')
      .then((records) => {
        if (records.length === 0) {
          const mockReports: Report[] = [
            {
              id: 'RI-2093',
              roadId: '4th Avenue, Midtown Crossing',
              title: 'Deep Pothole Cluster',
              damageType: 'Pothole',
              severity: 5,
              status: 'Pending Audit',
              description: 'Reported 2 hours ago. Major safety hazard for cyclists and small vehicles. Affecting traffic flow significantly during peak hours.',
              createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
              location: { lat: 18.5204, lng: 73.8567 },
            },
            {
              id: 'RI-1982',
              roadId: 'Expressway Link, North Exit',
              title: 'Faded Lane Markings',
              damageType: 'Signage',
              severity: 3,
              status: 'Work Assigned',
              description: 'Scheduled for Repair. Technician crew dispatched for Aug 12th midnight shift.',
              createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
              location: { lat: 19.076, lng: 72.8777 },
            },
          ];
          setReports(mockReports);
        } else {
          setReports(records);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-radial-bg min-h-screen text-on-surface font-body-md">
      <main className="container-max w-full">

        {/* ── Dashboard Header ── */}
        <section className="mb-xl flex flex-col md:flex-row md:items-end justify-between gap-lg">
          <div>
            <div className="flex items-center gap-sm mb-sm">
              <span className="px-3 py-1 rounded-lg font-label-md text-label-md uppercase select-none bg-surface-container-low border border-outline-variant text-primary">
                Citizen
              </span>
              <span className="text-tertiary font-label-md text-label-md tracking-widest uppercase flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">verified</span>
                Verified Account
              </span>
            </div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface mb-sm tracking-tight">
              Citizen Dashboard
            </h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl leading-relaxed">
              Monitor your local road health and reporting impact. Your data-driven voice shapes the infrastructure of tomorrow.
            </p>
          </div>

          <button
            onClick={() => navigate('/road/r1/report')}
            className="flex items-center gap-sm px-lg py-md rounded-lg font-label-md text-label-md bg-secondary text-white shadow-lg transition-all active:scale-95 hover:bg-primary cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined text-lg">add_circle</span>
            Report New Issue
          </button>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-lg">

          {/* ── Left Sidebar ── */}
          <aside className="md:col-span-3 flex flex-col gap-lg">
            {/* Navigation */}
            <div className="glass-panel rounded-2xl p-lg flex flex-col gap-xs">
              <h3 className="font-label-md text-label-md text-tertiary uppercase mb-sm tracking-wider">
                Navigation
              </h3>
              {[
                { label: 'Overview', icon: 'dashboard', path: '/dashboard', active: true },
                { label: 'View Map', icon: 'map', path: '/map' },
                { label: 'My History', icon: 'history', path: '/complaints' },
                { label: 'Profile', icon: 'contact_page', path: '/profile' },
              ].map(({ label, icon, path, active }) => (
                <button
                  key={label}
                  onClick={() => navigate(path)}
                  className={`w-full flex items-center gap-md p-sm rounded-lg font-body-md text-body-md text-left cursor-pointer transition-all ${
                    active
                      ? 'text-primary bg-surface-container-low'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
                  }`}
                >
                  <span className="material-symbols-outlined text-xl">{icon}</span>
                  {label}
                </button>
              ))}
            </div>

            {/* Local Events card */}
            <div className="glass-panel rounded-2xl p-lg relative overflow-hidden cursor-pointer transition-all hover:border-primary/50 group border-l-[3px] border-l-emerald-600">
              <div className="relative z-10">
                <h4 className="font-title-lg text-title-lg text-on-surface mb-xs">Local Events</h4>
                <p className="font-body-md text-body-md text-on-surface-variant mb-md leading-relaxed">
                  Road maintenance scheduled in your area for Aug 15.
                </p>
                <span className="text-primary font-label-md text-label-md flex items-center gap-1 group-hover:gap-2 transition-all">
                  Details
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </span>
              </div>
              <div className="absolute top-0 right-0 opacity-5 translate-x-1/4 -translate-y-1/4 group-hover:scale-110 transition-transform duration-300">
                <span className="material-symbols-outlined text-[100px]">construction</span>
              </div>
            </div>
          </aside>

          {/* ── Center: Recent Reports ── */}
          <section className="md:col-span-6 flex flex-col gap-lg">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-md text-headline-md text-on-surface tracking-tight">
                Recent Reports
              </h2>
              <button
                onClick={() => navigate('/complaints')}
                className="p-sm rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-colors cursor-pointer border border-outline-variant"
              >
                <span className="material-symbols-outlined text-xl">filter_list</span>
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center items-center py-xxl">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-on-surface/10 border-b-secondary" />
              </div>
            ) : reports.length === 0 ? (
              <div className="glass-panel rounded-2xl p-xxl text-center">
                <span className="material-symbols-outlined text-5xl text-on-surface-variant mb-md block">info</span>
                <p className="font-body-lg text-body-lg text-on-surface-variant font-semibold">
                  No reports filed yet.
                </p>
                <p className="font-body-md text-body-md text-on-surface-variant mt-xs">
                  Be the first to report an issue in your local community.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-lg">
                {reports.map((report) => {
                  const isSevere = report.severity >= 4;
                  return (
                    <div
                      key={report.id}
                      onClick={() => navigate(`/complaints/${report.id}`)}
                      className="glass-panel rounded-2xl p-lg cursor-pointer transition-all hover:shadow-lg hover:border-primary/50 group"
                    >
                      <div className={`rounded-xl flex flex-col gap-lg cursor-pointer transition-all hover:border-white/20 group backdrop-blur-md bg-surface-container-lowest border border-outline-variant p-6 ${isSevere ? 'border-l-4 border-error' : 'border-l-4 border-primary'}`}>
                        <div className="flex justify-between items-start gap-md">
                          <div>
                            <div className="flex items-center gap-sm mb-xs">
                              {isSevere ? (
                                <span className="font-label-md text-label-md flex items-center gap-1 select-none text-error">
                                  <span className="material-symbols-outlined text-sm">warning</span>
                                  SEVERE
                                </span>
                              ) : (
                                <span className="font-label-md text-label-md flex items-center gap-1 select-none text-primary">
                                  <span className="material-symbols-outlined text-sm">info</span>
                                  MODERATE
                                </span>
                              )}
                              <span className="text-on-surface-variant font-caption text-caption">
                                • Case #{report.id}
                              </span>
                            </div>
                            <h3 className="font-title-lg text-title-lg text-on-surface tracking-tight">
                              {report.title}
                            </h3>
                            <div className="flex items-center gap-xs text-on-surface-variant font-body-md text-body-md mt-xs">
                              <span className="material-symbols-outlined text-base">location_on</span>
                              {report.roadId}
                            </div>
                          </div>

                          <span className={`px-3 py-1 rounded-lg font-label-md text-label-md shrink-0 ${
                            report.status === 'Pending Audit'
                              ? 'bg-surface-container-low text-primary border border-outline-variant'
                              : report.status === 'Work Assigned'
                              ? 'bg-surface-container-low text-on-surface border border-outline-variant'
                              : 'bg-surface-container-lowest text-on-surface border border-outline-variant'
                          }`}>
                            {report.status}
                          </span>
                        </div>

                        {report.media ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
                            <div className="rounded-lg overflow-hidden h-32 relative border border-outline-variant">
                              <img
                                className="w-full h-full object-cover"
                                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDHPRKtPkNZdhdnjhML0eol-ICSNyn8q3PPikMiJUFpTtDXwJ84HLj8DMyAJIekHuXvV7UcS-yARMdr3qJnSKYeTo8S9eeL4AGEhX-omi0m9m5fzkgbzycXyzNQ4A8bGQ0EcHw4JeV0Kuv3fVv8oh4bpDazIKhPjJNgy_k9Ue4Ap-XvNs4mMLTBotQ0T76dE_7e07LVq4LwgzjslhZNtrQPQ_HjcQEOdsCmdn-FoByqhVhcLFrlCFTh3QSRiRMkUfxqcwt7OBWfSs4"
                                alt="Pothole Preview"
                              />
                            </div>
                            <div className="flex flex-col justify-center">
                              <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed line-clamp-3">
                                {report.description}
                              </p>
                            </div>
                          </div>
                        ) : (
                            <div className="flex items-center gap-md">
                            <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 bg-surface-container-low text-primary">
                              <span className="material-symbols-outlined text-2xl">engineering</span>
                            </div>
                            <div>
                              <p className="font-body-md text-body-md text-on-surface font-semibold">
                                Scheduled for Repair
                              </p>
                              <p className="font-caption text-caption text-on-surface-variant">
                                {report.description}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Right Sidebar: Insights ── */}
          <aside className="md:col-span-3 flex flex-col gap-lg">

            {/* Road Health Score */}
            <div className="glass-panel p-lg rounded-xl flex flex-col items-center text-center">
              <h3 className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest mb-md">
                Local Road Health
              </h3>
              <div className="relative w-32 h-32 flex items-center justify-center mb-md select-none">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
                  <circle cx="64" cy="64" fill="transparent" r="56" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                  <circle
                    cx="64" cy="64" fill="transparent" r="56"
                    stroke="url(#prismGrad)"
                    strokeDasharray="351.9"
                    strokeDashoffset="91"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  <defs>
                    <linearGradient id="prismGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#8B5CF6" />
                      <stop offset="100%" stopColor="#06B6D4" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-headline-md text-headline-md text-on-surface leading-none">74</span>
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase mt-xs">Index</span>
                </div>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant">
                District: <span className="text-on-surface font-semibold">Emerald Valley</span>
              </p>
              <div className="mt-md px-md py-sm rounded-lg font-label-md text-label-md flex items-center gap-1 select-none bg-surface-container-low text-primary">
                <span className="material-symbols-outlined text-sm">trending_up</span>
                ↑ 4% from last month
              </div>
            </div>

            {/* Personal Impact */}
            <div className="glass-panel p-lg rounded-xl">
              <h3 className="font-label-md text-label-md text-tertiary uppercase mb-md tracking-wider">
                Your Impact
              </h3>
              <div className="space-y-md">
                {[
                  { value: '12', label: 'Issues Resolved', icon: 'task_alt' },
                  { value: '450', label: 'Community Upvotes', icon: 'thumb_up' },
                  { value: 'Top 5%', label: 'Local Contributor', icon: 'verified' },
                ].map(({ value, label, icon }, i, arr) => (
                  <div
                    key={label}
                    className={`flex justify-between items-end pb-md ${i < arr.length - 1 ? 'border-b border-on-surface/10' : ''}`}
                  >
                    <div>
                      <p className="font-headline-md text-headline-md text-on-surface leading-none">{value}</p>
                      <p className="font-label-md text-label-md text-on-surface-variant uppercase mt-xs">{label}</p>
                    </div>
                    <span className="material-symbols-outlined text-4xl select-none text-primary opacity-30">{icon}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => navigate('/profile')}
                className="w-full mt-lg py-sm rounded-lg font-label-md text-label-md text-tertiary transition-colors hover:bg-surface-container-low/5 cursor-pointer text-center border border-secondary/30"
              >
                View Public Profile
              </button>
            </div>
          </aside>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="mt-xxl bg-surface-container-low border-t border-on-surface/5">
        <div className="flex flex-col md:flex-row justify-between items-start px-lg py-xl max-w-[1200px] mx-auto w-full gap-xl">
          <div>
            <div className="font-label-md text-label-md text-on-surface mb-sm tracking-wide">
              Global Infrastructure Grievance Platform
            </div>
            <div className="font-body-md text-body-md text-on-surface-variant max-w-xs leading-relaxed">
              Promoting Institutional Authority and Radical Transparency through decentralized infrastructure auditing.
            </div>
          </div>
          <div className="flex flex-wrap gap-xl">
            {[
              { heading: 'Resources', links: ['Open Data', 'Privacy', 'Terms'] },
              { heading: 'Connect', links: ['Government Contacts', 'API Documentation', 'Platform Status'] },
            ].map(({ heading, links }) => (
              <div key={heading} className="flex flex-col gap-sm">
                <span className="font-label-md text-label-md text-on-surface tracking-wider">{heading}</span>
                {links.map((l) => (
                  <a
                    key={l}
                    className="font-body-md text-body-md text-on-surface-variant hover:text-tertiary transition-colors cursor-pointer"
                    href="#"
                  >
                    {l}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="py-lg text-center font-caption text-caption text-on-surface-variant border-t border-on-surface/5">
          © 2024 Global Infrastructure Grievance Platform. All Rights Reserved.
        </div>
      </footer>
    </div>
  );
}