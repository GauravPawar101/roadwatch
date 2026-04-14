import { useEffect, useState } from 'react';
import { getAudit } from '../api';
import { getToken } from '../auth';

export function AuditLogPage() {
  const token = getToken();
  const [entries, setEntries] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getAudit(token)
      .then(setEntries)
      .catch((e: any) => setError(e?.message ?? 'Failed'));
  }, [token]);

  return (
    <>
      <h2>Audit Log</h2>
      <p className="muted">Every action recorded by the gateway (and can include Fabric txId when enabled).</p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Fabric Tx</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td>{e.actor_phone_masked ?? '—'}</td>
                <td>{e.action}</td>
                <td>
                  {e.target_type}:{e.target_id ?? '—'}
                </td>
                <td className="muted">{e.fabric_txid ?? '—'}</td>
              </tr>
            ))}
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">No audit entries yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {error ? <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div> : null}
    </>
  );
}
