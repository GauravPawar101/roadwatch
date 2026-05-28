import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authorityProfiles, complaints, jurisdictionMap, timelineEvents } from '../data/roadwatchDashboard';

type ContractorScorecardRow = {
  contractorId: string;
  contractorName: string;
  karmaScore: number;
  reliabilityRank: number;
  avgSlaSuccessDays: number | null;
  repeatFailureRate: number;
  budgetDisciplineScore: number;
  citizenSatisfactionScore: number;
  auditPerformanceScore: number;
  maintenanceEfficiencyScore: number;
  historicalDurabilityDays: number;
  regionalExpertise: string[];
  roadTypeSpecialization: string[];
  riskIndicator: 'low' | 'medium' | 'high';
  lifecycleCostINR: number;
  proposalConfidence: number;
}

type ProposalIntelligence = {
  generatedAt: string;
  scope: { district: string | null; zone: string | null; roadType: string | null };
  plannedLengthKm: number;
  requestedBudgetINR: number | null;
  materialEstimateINR: number;
  laborEstimateINR: number;
  maintenanceReserveINR: number;
  lifecycleOwnershipCostINR: number;
  forecastRepairProbability: number;
  inflatedBudgetFlag: boolean;
  anomalyReason: string | null;
  contractorRecommendations: Array<{
    contractorId: string;
    contractorName: string;
    karmaScore: number;
    reliabilityRank: number;
    budgetDisciplineScore: number;
    durabilityScore: number;
    riskIndicator: 'low' | 'medium' | 'high';
    regionalExpertise: string[];
    roadTypeSpecialization: string[];
    estimatedLifecycleCostINR: number;
    proposalConfidence: number;
  }>;
}

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
  const apiBase = ((import.meta as any).env?.VITE_API_BASE as string | undefined) || 'http://localhost:3100'
  const [sortKey, setSortKey] = useState<'karmaScore' | 'budgetDisciplineScore' | 'maintenanceEfficiencyScore' | 'historicalDurabilityDays' | 'proposalConfidence'>('karmaScore')
  const [roadType, setRoadType] = useState('NH')
  const [plannedLengthKm, setPlannedLengthKm] = useState(12)
  const [requestedBudget, setRequestedBudget] = useState('')
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

  const scorecardQuery = useQuery({
    queryKey: ['public-contractor-scorecard', roadType],
    queryFn: async () => {
      const response = await fetch(`${apiBase}/public/contractors/scorecard?limit=20`)
      if (!response.ok) throw new Error(`Failed to load scorecard: ${response.status}`)
      return (await response.json()) as { rows: ContractorScorecardRow[] }
    }
  })

  const proposalQuery = useQuery({
    queryKey: ['public-proposal-intelligence', roadType, plannedLengthKm, requestedBudget],
    queryFn: async () => {
      const params = new URLSearchParams({ roadType, plannedLengthKm: String(plannedLengthKm) })
      if (requestedBudget.trim()) params.set('requestedBudgetINR', requestedBudget.trim())
      const response = await fetch(`${apiBase}/public/proposals/intelligence?${params.toString()}`)
      if (!response.ok) throw new Error(`Failed to load proposal intelligence: ${response.status}`)
      return (await response.json()) as ProposalIntelligence
    }
  })

  const contractorRows = useMemo(() => {
    const rows = scorecardQuery.data?.rows ?? []
    return rows.slice().sort((left, right) => {
      const leftValue = left[sortKey]
      const rightValue = right[sortKey]
      return Number(rightValue) - Number(leftValue)
    })
  }, [scorecardQuery.data, sortKey])

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
          <div className="glass-panel rounded-xl p-lg">
            <div className="muted-upper">New road proposal intelligence</div>
            <h2 className="stitch-mt-10 stitch-font-24 stitch-font-800 stitch-text-white-80">Budgeting, lifecycle cost, and anomaly detection</h2>
            <p className="stitch-mt-10 stitch-text-secondary">Enter a road type and length to estimate material, labor, maintenance reserve, and lifecycle ownership cost.</p>
            <div className="stitch-mt-16 stitch-display-grid stitch-gap-12" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <label className="stitch-display-grid stitch-gap-6">
                <span className="stitch-text-12 stitch-text-secondary">Road type</span>
                <select value={roadType} onChange={(event) => setRoadType(event.target.value)} className="stitch-rounded-16 stitch-px-12 stitch-py-10" style={{ background: '#fff', color: '#1a1b1e' }}>
                  <option value="NH">NH</option>
                  <option value="SH">SH</option>
                  <option value="MDR">MDR</option>
                  <option value="Urban arterial">Urban arterial</option>
                  <option value="Rural connector">Rural connector</option>
                </select>
              </label>
              <label className="stitch-display-grid stitch-gap-6">
                <span className="stitch-text-12 stitch-text-secondary">Length (km)</span>
                <input type="number" min="0.5" step="0.5" value={plannedLengthKm} onChange={(event) => setPlannedLengthKm(Number(event.target.value))} className="stitch-rounded-16 stitch-px-12 stitch-py-10" style={{ background: '#fff', color: '#1a1b1e' }} />
              </label>
              <label className="stitch-display-grid stitch-gap-6">
                <span className="stitch-text-12 stitch-text-secondary">Requested budget (INR)</span>
                <input type="text" placeholder="Optional" value={requestedBudget} onChange={(event) => setRequestedBudget(event.target.value)} className="stitch-rounded-16 stitch-px-12 stitch-py-10" style={{ background: '#fff', color: '#1a1b1e' }} />
              </label>
            </div>

            <div className="stitch-mt-16 stitch-display-grid stitch-gap-12" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              {[
                { label: 'Material estimate', value: proposalQuery.data?.materialEstimateINR ?? 0 },
                { label: 'Labor estimate', value: proposalQuery.data?.laborEstimateINR ?? 0 },
                { label: 'Maintenance reserve', value: proposalQuery.data?.maintenanceReserveINR ?? 0 },
                { label: 'Lifecycle ownership', value: proposalQuery.data?.lifecycleOwnershipCostINR ?? 0 },
              ].map((item) => (
                <div key={item.label} className="glass-panel rounded-xl p-md">
                  <div className="muted-upper">{item.label}</div>
                  <div className="stitch-mt-10 stitch-font-800 stitch-font-24 stitch-text-white-80">₹{item.value.toLocaleString('en-IN')}</div>
                </div>
              ))}
            </div>

            <div className="stitch-mt-16 glass-panel rounded-xl p-md">
              <div className="stitch-display-flex stitch-justify-between stitch-gap-12 stitch-flex-wrap">
                <div>
                  <div className="muted-upper">Forecast</div>
                  <div className="stitch-mt-10 stitch-font-800 stitch-font-20 stitch-text-white-80">Repair probability {proposalQuery.data?.forecastRepairProbability ?? 0}%</div>
                </div>
                <div className={`stitch-rounded-999 stitch-px-12 stitch-py-8 ${proposalQuery.data?.inflatedBudgetFlag ? 'bg-red-500/20' : 'bg-emerald-500/20'}`}>
                  {proposalQuery.data?.inflatedBudgetFlag ? 'Budget anomaly detected' : 'Budget within benchmark'}
                </div>
              </div>
              <p className="stitch-mt-10 stitch-text-secondary">{proposalQuery.data?.anomalyReason ?? 'Benchmark looks consistent with the current lifecycle model.'}</p>
            </div>
          </div>

          <div className="glass-panel rounded-xl p-lg">
            <div className="muted-upper">Contractor intelligence shortlist</div>
            <h2 className="stitch-mt-10 stitch-font-24 stitch-font-800 stitch-text-white-80">Ranked contractors for proposals</h2>
            <div className="stitch-mt-12 stitch-display-flex stitch-gap-10 stitch-flex-wrap">
              {(['karmaScore', 'budgetDisciplineScore', 'maintenanceEfficiencyScore', 'historicalDurabilityDays', 'proposalConfidence'] as const).map((option) => (
                <button key={option} onClick={() => setSortKey(option)} className="chip" style={{ opacity: sortKey === option ? 1 : 0.7 }}>
                  {option}
                </button>
              ))}
            </div>
            <div className="stitch-mt-16 stitch-display-grid stitch-gap-12">
              {contractorRows.slice(0, 5).map((row) => (
                <div key={row.contractorId} className="glass-panel rounded-xl p-md">
                  <div className="stitch-display-flex stitch-justify-between stitch-gap-12">
                    <div>
                      <div className="stitch-font-800 stitch-text-white-80">{row.contractorName}</div>
                      <div className="stitch-text-12 stitch-text-secondary">Rank #{row.reliabilityRank} · {row.riskIndicator} risk</div>
                    </div>
                    <div className="stitch-text-right">
                      <div className="stitch-font-800 stitch-font-24">{row.karmaScore}</div>
                      <div className="stitch-text-12 stitch-text-secondary">karma</div>
                    </div>
                  </div>
                  <div className="stitch-mt-10 stitch-display-flex stitch-gap-8 stitch-flex-wrap">
                    {row.roadTypeSpecialization.slice(0, 3).map((item) => (
                      <span key={item} className="chip">{item}</span>
                    ))}
                  </div>
                  <div className="stitch-mt-10 stitch-text-12 stitch-text-secondary">
                    Durability {row.historicalDurabilityDays}d · Budget {row.budgetDisciplineScore} · Proposal confidence {row.proposalConfidence}
                  </div>
                </div>
              ))}
            </div>
            <div className="stitch-mt-16 stitch-text-12 stitch-text-secondary">
              Recommendation source: {proposalQuery.data?.contractorRecommendations?.[0]?.contractorName ?? 'waiting for live data'}
            </div>
          </div>
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
