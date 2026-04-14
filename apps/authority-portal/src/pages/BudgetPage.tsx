import React, { useEffect, useMemo, useState } from 'react';
import { districtReportUrl, getBudget } from '../api';
import { getToken, getUser } from '../auth';

export function BudgetPage() {
  const token = getToken();
  const user = getUser<any>();
  const defaultDistrict = useMemo(() => {
    if (!user) return undefined;
    const d = Array.isArray(user.districts) ? user.districts : [];
    return d.find((x: string) => x && x !== 'ALL');
  }, [user]);

  const [district, setDistrict] = useState<string | undefined>(defaultDistrict);
  const [budget, setBudget] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDistrict(defaultDistrict);
  }, [defaultDistrict]);

  useEffect(() => {
    if (!token) return;
    getBudget(token, district)
      .then(setBudget)
      .catch((e: any) => setError(e?.message ?? 'Failed'));
  }, [token, district]);

  return (
    <>
      <h2>Budget</h2>
      <p className="muted">Backlog estimate is derived from open complaint counts.</p>

      <div className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 240 }}>
            <div className="muted">District (optional)</div>
            <input value={district ?? ''} onChange={(e) => setDistrict(e.target.value || undefined)} placeholder="e.g., Delhi" />
          </div>
          <div>
            <div className="muted">Estimated backlog cost</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {typeof budget?.estimatedBacklogCostINR === 'number'
                ? budget.estimatedBacklogCostINR.toLocaleString('en-IN')
                : '—'}
              <span className="muted" style={{ fontSize: 14, marginLeft: 6 }}>INR</span>
            </div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            {token && district ? (
              <a href={districtReportUrl(token, district)}>
                <button>Download District Report (PDF)</button>
              </a>
            ) : (
              <button disabled>Download District Report (PDF)</button>
            )}
          </div>
        </div>
        <div className="muted" style={{ marginTop: 12 }}>
          Model: Pending={budget?.model?.PENDING ?? '—'} / In Progress={budget?.model?.IN_PROGRESS ?? '—'} / Rejected={budget?.model?.REJECTED ?? '—'}
        </div>
      </div>

      {error ? <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div> : null}
    </>
  );
}
