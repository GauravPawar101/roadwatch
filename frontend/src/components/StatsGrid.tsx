
import { StatsGrid as Grid, StatCard } from './UIComponents'

const stats = [
  { value: '1,245 km', label: 'Monitored Length' },
  { value: '342', label: 'Incidents Today' },
  { value: '98%', label: 'Data Freshness' },
]

export default function StatsGrid() {
  return (
    <Grid>
      {stats.map((s) => (
        <StatCard key={s.label} value={s.value} label={s.label} />
      ))}
    </Grid>
  )
}
