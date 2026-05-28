import { useEffect, useState } from 'react'

type PerformanceRow = {
  userId: string
  role: string
  district: string
  actionsTaken: number
  avgResolutionHours: number
  avgAiRepairScore: number
  karmaScore: number
  rank: number
}

type PerformanceResponse = {
  generatedAt: string
  employees: PerformanceRow[]
  contractors: PerformanceRow[]
}

import { Card, CardBody, Container, Spinner } from '../components/UIComponents'

function MetricTable({ title, rows }: { title: string; rows: PerformanceRow[] }) {
  return (
    <Card style={{ overflowX: 'auto' }}>
      <CardBody>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #dbeafe' }}>
            <th style={{ padding: 8 }}>Rank</th>
            <th style={{ padding: 8 }}>User</th>
            <th style={{ padding: 8 }}>District</th>
            <th style={{ padding: 8 }}>Actions</th>
            <th style={{ padding: 8 }}>Avg Resolve (hrs)</th>
            <th style={{ padding: 8 }}>Avg AI Score</th>
            <th style={{ padding: 8 }}>Karma</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.role}:${r.userId}`} style={{ borderBottom: '1px solid #eff6ff' }}>
              <td style={{ padding: 8, fontWeight: 700 }}>{r.rank}</td>
              <td style={{ padding: 8 }}>{r.userId}</td>
              <td style={{ padding: 8 }}>{r.district}</td>
              <td style={{ padding: 8 }}>{r.actionsTaken}</td>
              <td style={{ padding: 8 }}>{Number(r.avgResolutionHours || 0).toFixed(2)}</td>
              <td style={{ padding: 8 }}>{Number(r.avgAiRepairScore || 0).toFixed(2)}</td>
              <td style={{ padding: 8, fontWeight: 700 }}>{Number(r.karmaScore || 0).toFixed(2)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td style={{ padding: 10, color: 'var(--color-muted)' }} colSpan={7}>No data yet.</td>
            </tr>
          )}
        </tbody>
      </table>
      </CardBody>
    </Card>
  )
}

export default function PerformanceEvaluation() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PerformanceResponse | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('roadwatch_token')
    const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100'
    if (!token) {
      setError('Login token missing. Please sign in to load performance data.')
      setLoading(false)
      return
    }
    fetch(`${apiBase}/authority/performance/evaluation`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error('Failed to load authority performance metrics')
        return resp.json()
      })
      .then((payload) => setData(payload))
      .catch((e) => setError(e.message || 'Unable to fetch performance metrics'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <Container>
      <div style={{ maxWidth: 1150, margin: '6px auto', display: 'grid', gap: 14 }}>
        <h2 style={{ margin: 0 }}>Performance Evaluation</h2>
        <div style={{ color: 'var(--color-muted)' }}>
          Authority karma ranking based on verified repair quality, action volume, and response speed.
        </div>
        {loading && (
          <Card>
            <CardBody>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Spinner />
                <div>Loading metrics...</div>
              </div>
            </CardBody>
          </Card>
        )}
        {error && (
          <Card>
            <CardBody>
              <div style={{ color: '#7f1d1d' }}>{error}</div>
            </CardBody>
          </Card>
        )}
        {!loading && !error && (
          <>
            <MetricTable title="Employees" rows={data?.employees || []} />
            <MetricTable title="Contractors" rows={data?.contractors || []} />
          </>
        )}
      </div>
    </Container>
  )
}
