import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
    getPublicDashboard,
    publicExportCsvUrl,
    publicExportGeoJsonUrl,
    publicExportPdfUrl,
    type PublicDashboard
} from '../api';
import { clearAuth, getUser } from '../auth';

export function PublicDashboardPage() {
  const [data, setData] = useState<PublicDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const user = getUser<any>();

  useEffect(() => {
    getPublicDashboard()
      .then(setData)
      .catch((e: any) => setError(e?.message ?? 'Failed'));
  }, []);

  const chartData = useMemo(
    () => Object.entries(data?.byStatus ?? {}).map(([status, count]) => ({ status, count })),
    [data]
  );

  const unresolved = (data?.totals.total ?? 0) - (data?.byStatus?.RESOLVED ?? 0);

  return (
    <div className="container">
      <h1>Public Road Health Dashboard</h1>
      <p className="muted">City-wide summary. No login required.</p>

      {user?.phone ? (
        <div className="card" style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600 }}>Signed in</div>
            <div className="muted" style={{ marginTop: 4 }}>{user.role ?? ''} {user.phone}</div>
          </div>
          <button className="secondary" onClick={() => clearAuth()}>Sign out</button>
        </div>
      ) : null}

      <div className="row">
        <div className="card">
          <div className="muted">Road health index</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{data ? `${data.roadHealthIndex}/100` : '—'}</div>
          <div className="muted" style={{ marginTop: 6 }}>Derived from unresolved share of complaints.</div>
        </div>
        <div className="card">
          <div className="muted">Total complaints</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{data?.totals.total ?? '—'}</div>
        </div>
        <div className="card">
          <div className="muted">Unresolved</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{data ? unresolved : '—'}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 600 }}>By status</div>
          <div className="muted" style={{ fontSize: 12 }}>Updated: {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : '—'}</div>
        </div>
        <div style={{ width: '100%', height: 320, marginTop: 12 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="status" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#111827" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <div className="card" style={{ flex: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ fontWeight: 600 }}>Chronic road public feed</div>
            <div className="muted" style={{ fontSize: 12 }}>{data?.chronic?.rule ?? ''}</div>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>Unresolved issues older than {data?.chronic.chronicDays ?? 60} days are shown here.</div>

          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Area</th>
                  <th>Age</th>
                  <th>Status</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {(data?.chronic.items ?? []).map((c) => (
                  <tr key={c.complaintId}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{c.complaintId}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.district} / {c.zone}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.ageDays}d</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.status}</td>
                    <td>{c.description}</td>
                  </tr>
                ))}
                {data && (data.chronic.items?.length ?? 0) === 0 ? (
                  <tr><td colSpan={5} className="muted">No chronic roads in this view.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <a href={publicExportCsvUrl({ chronicOnly: true })}><button className="secondary">Export CSV</button></a>
            <a href={publicExportGeoJsonUrl({ chronicOnly: true })}><button className="secondary">Export GeoJSON</button></a>
            <a href={publicExportPdfUrl({})}><button className="secondary">Export PDF</button></a>
          </div>
        </div>

        <div className="card" style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Hotspots (clustered)</div>
          <div className="muted" style={{ marginTop: 6 }}>Grid-based clustering on complaint coordinates (top 20).</div>
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Cluster</th>
                  <th>Count</th>
                  <th>Centroid</th>
                </tr>
              </thead>
              <tbody>
                {(data?.hotspots ?? []).map((h) => (
                  <tr key={h.key}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{h.key}</td>
                    <td>{h.count}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{h.centroid.lat.toFixed(4)}, {h.centroid.lng.toFixed(4)}</td>
                  </tr>
                ))}
                {data && (data.hotspots?.length ?? 0) === 0 ? (
                  <tr><td colSpan={3} className="muted">No hotspot data available.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <div className="card" style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Worsening trends</div>
          <div className="muted" style={{ marginTop: 6 }}>Compares recent vs previous time window per cluster.</div>
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Cluster</th>
                  <th>Recent</th>
                  <th>Previous</th>
                  <th>Open</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {(data?.trends ?? []).map((t) => (
                  <tr key={t.key}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{t.key}</td>
                    <td>{t.recentCount}</td>
                    <td>{t.previousCount}</td>
                    <td>{t.openCount}</td>
                    <td>{t.score.toFixed(2)}</td>
                  </tr>
                ))}
                {data && (data.trends?.length ?? 0) === 0 ? (
                  <tr><td colSpan={5} className="muted">No trend signals detected.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Contractor public scorecard</div>
          <div className="muted" style={{ marginTop: 6 }}>Requires authority assignment data.</div>
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Contractor</th>
                  <th>Assigned</th>
                  <th>Resolved</th>
                  <th>Open</th>
                  <th>Avg</th>
                  <th>On-time</th>
                </tr>
              </thead>
              <tbody>
                {(data?.contractorScorecard ?? []).map((c) => (
                  <tr key={c.contractorId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.contractorName}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{c.contractorId}</div>
                    </td>
                    <td>{c.assignedCount}</td>
                    <td>{c.resolvedCount}</td>
                    <td>{c.openCount}</td>
                    <td>{c.avgResolutionDays == null ? '—' : `${c.avgResolutionDays.toFixed(1)}d`}</td>
                    <td>{c.onTimeRate == null ? '—' : `${Math.round(c.onTimeRate * 100)}%`}</td>
                  </tr>
                ))}
                {data && (data.contractorScorecard?.length ?? 0) === 0 ? (
                  <tr><td colSpan={6} className="muted">No contractor data yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {error ? <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div> : null}
    </div>
  );
}
