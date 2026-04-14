import { useEffect, useMemo, useState } from 'react';
import { createAdminUser, listAdminUsers, type AdminUserRow } from '../api';
import { getToken } from '../auth';

function parseCsv(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function AdminUsersPage() {
  const token = getToken();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState('');
  const [govtId, setGovtId] = useState('');
  const [role, setRole] = useState<'CE' | 'EE'>('EE');
  const [districts, setDistricts] = useState('');
  const [zones, setZones] = useState('');

  async function refresh() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const list = await listAdminUsers(token, { limit: 500 });
      setUsers(list);
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const sorted = useMemo(() => {
    const copy = [...users];
    copy.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return copy;
  }, [users]);

  return (
    <>
      <h2>Admin: Authority Accounts</h2>
      <p className="muted">Create and manage authority/admin logins (CE-only).</p>

      <div className="card" style={{ maxWidth: 720 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="muted">Phone</div>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="muted">Govt/Employee ID</div>
            <input value={govtId} onChange={(e) => setGovtId(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className="row" style={{ marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="muted">Role</div>
            <select value={role} onChange={(e) => setRole(e.target.value as any)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
              <option value="EE">EE</option>
              <option value="CE">CE</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="muted">Districts (comma-separated)</div>
            <input value={districts} onChange={(e) => setDistricts(e.target.value)} placeholder="ALL or D1,D2" />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="muted">Zones (comma-separated)</div>
            <input value={zones} onChange={(e) => setZones(e.target.value)} placeholder="ALL or Z1,Z2" />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            disabled={busy || !token || phone.trim().length < 6}
            onClick={async () => {
              if (!token) return;
              setBusy(true);
              setError(null);
              try {
                await createAdminUser(token, {
                  phone: phone.trim(),
                  role,
                  govtId: govtId.trim() || undefined,
                  districts: parseCsv(districts),
                  zones: parseCsv(zones)
                });
                setPhone('');
                setGovtId('');
                setDistricts('');
                setZones('');
                await refresh();
              } catch (e: any) {
                setError(e?.message ?? 'Failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            Create account
          </button>
          <button className="secondary" disabled={busy || !token} onClick={refresh}>
            Refresh
          </button>
        </div>

        {error ? <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div> : null}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>Existing accounts</div>
          <div className="muted" style={{ fontSize: 12 }}>{busy ? 'Loading…' : `${sorted.length} total`}</div>
        </div>

        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Phone</th>
                <th>Govt ID</th>
                <th>Districts</th>
                <th>Zones</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.role}</td>
                  <td>{u.phone}</td>
                  <td>{u.govtId ?? '—'}</td>
                  <td className="muted">{u.districts?.length ? u.districts.join(', ') : '—'}</td>
                  <td className="muted">{u.zones?.length ? u.zones.join(', ') : '—'}</td>
                  <td className="muted">{new Date(u.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
