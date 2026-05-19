import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { authorityProfiles, complaints, jurisdictionMap, timelineEvents } from '../data/roadwatchDashboard';

function ChartCard({ title, series }: { title: string; series: number[] }) {
  const max = Math.max(...series, 1)
  return (
    <div className="glass-panel p-md rounded-xl">
      <div className="text-on-surface stitch-font-800">{title}</div>
      <div className="stitch-display-grid stitch-justify-items-center stitch-items-end stitch-gap-10 stitch-mt-14" style={{ gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))`, minHeight: 160 }}>
        {series.map((value, index) => (
          <div key={`${title}-${index}`} className="stitch-display-grid stitch-gap-8 stitch-justify-items-center">
            <div className="stitch-display-flex stitch-items-end" style={{ width: '100%', minHeight: 120 }}>
              <div style={{ width: '100%', height: `${(value / max) * 100}%`, minHeight: 20, borderRadius: 16 }} className="progress-gradient" />
            </div>
            <div className="stitch-text-12 stitch-text-secondary">{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function JurisdictionComparisonTable({ rows }: { rows: Array<{ label: string; current: number; previous: number; trend: string }> }) {
  return (
    <div className="glass-panel p-md rounded-xl">
      <div className="text-on-surface stitch-font-800">Jurisdiction comparison</div>
      <div className="stitch-display-grid stitch-gap-10 stitch-mt-14">
        {rows.map((row) => (
          <div key={row.label} className="stitch-display-grid stitch-gap-12 stitch-items-center" style={{ gridTemplateColumns: '1.2fr 0.6fr 0.6fr 0.7fr' }}>
            <div className="stitch-text-white-80 stitch-font-700">{row.label}</div>
            <div className="stitch-text-secondary">{row.current}</div>
            <div className="stitch-text-secondary">{row.previous}</div>
            <div className="stitch-text-secondary">{row.trend}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EscalationHeatmap({ nodes }: { nodes: Array<{ name: string; risk: number }> }) {
  return (
    <div className="glass-panel p-md rounded-xl">
      <div className="text-on-surface stitch-font-800">Escalation heatmap</div>
      <div className="stitch-display-grid stitch-gap-10 stitch-mt-14">
        {nodes.map((node) => (
          <div key={node.name} className="stitch-display-grid stitch-gap-8">
            <div className="stitch-display-flex stitch-justify-between stitch-gap-12">
              <span className="stitch-text-secondary">{node.name}</span>
              <span className="stitch-text-secondary">{node.risk}%</span>
            </div>
            <div className="stitch-rounded-999 stitch-overflow-hidden" style={{ height: 8, background: 'rgba(255,255,255,0.08)' }}>
              <div style={{ width: `${node.risk}%`, height: '100%' }} className="progress-gradient" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReportExporter({ onExport }: { onExport: (format: 'csv' | 'pdf') => void }) {
  return (
    <div className="stitch-display-flex stitch-gap-10 stitch-flex-wrap">
      <button onClick={() => onExport('pdf')} className="btn-muted-gradient">
        Export PDF
      </button>
      <button onClick={() => onExport('csv')} className="btn-ghost">
        Export CSV
      </button>
    </div>
  )
}

export default function Analytics(){
  const navigate = useNavigate()
  const metrics = useMemo(() => {
    const total = complaints.length
    const resolved = complaints.filter((item) => item.status === 'Resolved').length
    const avgResponse = (complaints.reduce((sum, item) => sum + item.slaHoursLeft, 0) / Math.max(1, total)).toFixed(1)
    return {
      total,
      resolved,
      avgResponse,
      trustScore: 94.8,
    }
  }, [])

  const topAreas = jurisdictionMap.slice().sort((left, right) => right.openCases - left.openCases).slice(0, 5)
  const trendBars = [72, 84, 90, 86, 94, 88, 96]
  const leadAuthority = authorityProfiles[1] ?? authorityProfiles[0]
  const comparisonRows = topAreas.map((area, index) => ({
    label: area.name,
    current: area.openCases,
    previous: Math.max(0, area.openCases - (index + 2)),
    trend: index % 2 === 0 ? '↑' : '→',
  }))

  function handleExport(format: 'csv' | 'pdf') {
    const payload = { format, generatedAt: new Date().toISOString(), total: metrics.total, resolved: metrics.resolved }
    console.info('Export request', payload)
    alert(`Prepared ${format.toUpperCase()} export for authority analytics.`)
  }

  return (
    <div className="page-radial-bg stitch-minh-100vh" style={{ color: '#dbeafe' }}>
      <div className="container-max">
        <section className="glass-panel rounded-2xl p-lg">
          <div className="stitch-display-flex stitch-justify-between stitch-gap-20 stitch-flex-wrap">
            <div style={{ maxWidth: 860 }}>
              <div className="muted-upper">Analytics & strategic oversight</div>
              <h1 style={{ marginTop: 12, fontSize: 'clamp(2.2rem, 4vw, 4rem)', lineHeight: 1.05, letterSpacing: '-0.04em', fontWeight: 900, color: '#f8fafc' }}>
                Infrastructure governance analytics
              </h1>
              <p className="body-md stitch-mt-14" style={{ maxWidth: 720 }}>
                Visualizing performance metrics, infrastructure health, and service delivery benchmarks across regional jurisdictions.
              </p>
            </div>
            <div className="glass-panel rounded-xl p-md stitch-minw-300 stitch-flex-0-1-340">
              <div className="muted-upper">Lead reviewer</div>
              <div className="stitch-mt-10 stitch-font-24 stitch-font-800 stitch-text-white-80">{leadAuthority.name}</div>
              <div className="stitch-mt-6 stitch-text-secondary">{leadAuthority.role}</div>
              <button onClick={() => navigate('/authority/report')} className="btn-muted-gradient stitch-mt-16 stitch-w-100p">
                Export district report
              </button>
            </div>
          </div>
        </section>

        <section className="stitch-grid-4cols stitch-mt-20">
            {[
            { label: 'Avg response time', value: `${metrics.avgResponse}h`, detail: 'Mean queue response pressure across active authority work.' },
            { label: 'SLA compliance', value: '94.8%', detail: 'Share of resolved and approved cases within target.' },
            { label: 'Critical escalations', value: '24', detail: 'High severity issues flagged for executive review.' },
            { label: 'Citizen trust score', value: `${metrics.trustScore} / 5.0`, detail: 'Rolling trust and resolution quality composite.' },
            ].map((item) => (
            <div key={item.label} className="glass-panel rounded-xl p-md">
              <div className="muted-upper">{item.label}</div>
              <div className="stitch-mt-10 stitch-font-800 stitch-font-24 stitch-text-white-80">{item.value}</div>
              <div className="stitch-mt-8 stitch-text-secondary stitch-line-height-16">{item.detail}</div>
            </div>
          ))}
        </section>

        <section className="stitch-mt-20">
          <ReportExporter onExport={handleExport} />
        </section>

        <section className="grid-two-col stitch-mt-20">
          <div className="stitch-display-grid stitch-gap-20">
            <div className="glass-panel rounded-xl p-lg">
              <div className="stitch-display-flex stitch-justify-between stitch-items-center stitch-gap-14 stitch-flex-wrap">
                <div>
                  <div className="muted-upper">Response time trends</div>
                  <h2 className="stitch-mt-10 stitch-font-24 stitch-font-800 stitch-text-white-80">Efficiency performance across major municipalities</h2>
                </div>
                <div className="stitch-text-13 stitch-text-secondary">Last 30 days</div>
              </div>
              <div className="stitch-display-grid stitch-gap-12" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', alignItems: 'end', marginTop: 18, minHeight: 220 }}>
                {trendBars.map((value, index) => (
                    <div key={`${index}-${value}`} className="stitch-display-grid stitch-gap-10 stitch-justify-items-center">
                    <div className="stitch-display-flex stitch-items-end" style={{ width: '100%', minHeight: 160 }}>
                      <div style={{ width: '100%', height: `${value}%`, minHeight: 28, borderRadius: 18, boxShadow: '0 16px 32px rgba(6,182,212,0.22)' }} className="progress-gradient" />
                    </div>
                    <div className="stitch-text-12 stitch-text-secondary">Day {index + 1}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-panel rounded-xl p-lg">
              <div className="muted-upper">Jurisdiction comparison</div>
              <h2 className="stitch-mt-10 stitch-font-24 stitch-font-800 stitch-text-white-80">Regional benchmarking</h2>
              <div className="stitch-mt-16">
                <JurisdictionComparisonTable rows={comparisonRows} />
              </div>
            </div>

            <ChartCard title="Complaint trends" series={[12, 18, 24, 19, 26, 21, 16]} />
            <ChartCard title="Contractor performance" series={[8, 10, 11, 13, 15, 14, 9]} />
            <ChartCard title="Budget utilization" series={[42, 45, 48, 52, 57, 61, 63]} />
            <ChartCard title="SLA compliance" series={[88, 90, 91, 92, 94, 95, 96]} />
          </div>

          <aside className="stitch-display-grid stitch-gap-20">
            <EscalationHeatmap nodes={topAreas.map((area) => ({ name: area.name, risk: area.risk }))} />

            <section className="glass-panel rounded-xl p-lg">
              <div className="muted-upper">Audit log</div>
              <h3 className="stitch-mt-10 stitch-font-24 stitch-font-800 stitch-text-white-80">Recent authority events</h3>
              <div className="stitch-mt-16 stitch-display-grid stitch-gap-12">
                {timelineEvents.map((event) => (
                  <div key={event.id} className="glass-panel stitch-rounded-18 stitch-p-14">
                    <div className="stitch-display-flex stitch-justify-between stitch-gap-12">
                      <div className="stitch-font-800 stitch-text-white-80">{event.title}</div>
                      <div className="stitch-text-12 stitch-text-muted">{event.time}</div>
                    </div>
                    <div className="stitch-mt-8 stitch-text-secondary stitch-line-height-16">{event.description}</div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </div>
  )
}
