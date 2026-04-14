import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getAnalytics } from '../api';
import { getToken } from '../auth';

export function AnalyticsPage() {
  const token = getToken();
  const [data, setData] = useState<{ byStatus: Record<string, number>; totals: { total: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getAnalytics(token)
      .then(setData)
      .catch((e: any) => setError(e?.message ?? 'Failed'));
  }, [token]);

  const chartData = Object.entries(data?.byStatus ?? {}).map(([status, count]) => ({ status, count }));

  return (
    <>
      <h2>Analytics</h2>
      <div className="row">
        <div className="card">
          <div className="muted">Total complaints</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{data?.totals.total ?? '—'}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 12, fontWeight: 600 }}>By status</div>
        <div style={{ width: '100%', height: 320 }}>
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

      {error ? <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div> : null}
    </>
  );
}
