import { useEffect, useMemo, useState } from 'react';
import { eventsUrl, listComplaints, resolveComplaint, type Complaint } from '../api';
import { getToken } from '../auth';

export function ComplaintQueuePage() {
  const token = getToken();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = useMemo(() => complaints.filter((c) => c.status !== 'RESOLVED'), [complaints]);

  async function reload() {
    if (!token) return;
    const rows = await listComplaints(token);
    setComplaints(rows);
  }

  useEffect(() => {
    if (!token) return;
    reload().catch((e: any) => setError(e?.message ?? 'Failed'));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(eventsUrl(token));
    es.addEventListener('complaint_created', (ev) => {
      const data = JSON.parse((ev as MessageEvent).data);
      setComplaints((prev) => [data.complaint, ...prev]);
    });
    es.addEventListener('complaint_updated', (ev) => {
      const data = JSON.parse((ev as MessageEvent).data);
      setComplaints((prev) => prev.map((c) => (c.id === data.complaint.id ? data.complaint : c)));
    });
    es.addEventListener('complaint_resolved', (ev) => {
      const data = JSON.parse((ev as MessageEvent).data);
      setComplaints((prev) => prev.map((c) => (c.id === data.complaint.id ? data.complaint : c)));
    });
    return () => es.close();
  }, [token]);

  return (
    <>
      <div className="toolbar">
        <div>
          <h2>Complaint Queue</h2>
          <p className="muted">Live updates stream in automatically.</p>
        </div>
        <span className="badge">Open: {pending.length}</span>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>District / Zone</th>
              <th>Status</th>
              <th>Description</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pending.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td>
                  {c.district}
                  <div className="muted">{c.zone}</div>
                </td>
                <td>
                  <span
                    className={
                      c.status === 'RESOLVED'
                        ? 'badge status-resolved'
                        : 'badge status-pending'
                    }
                  >
                    {c.status}
                  </span>
                </td>
                <td>{c.description}</td>
                <td style={{ width: 160 }}>
                  <button
                    disabled={!token || busyId === c.id || c.status === 'RESOLVED'}
                    onClick={async () => {
                      if (!token) return;
                      setBusyId(c.id);
                      setError(null);
                      try {
                        await resolveComplaint(token, c.id);
                        await reload();
                      } catch (e: any) {
                        setError(e?.message ?? 'Failed');
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    Mark Resolved
                  </button>
                </td>
              </tr>
            ))}
            {pending.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">No open complaints.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
    </>
  );
}
