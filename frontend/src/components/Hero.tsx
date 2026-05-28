
import { Button } from './UIComponents'

export default function Hero() {
  return (
    <section style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px' }}>
      <div style={{ borderRadius: 16, background: 'linear-gradient(90deg, var(--color-primary), var(--color-accent))', color: 'white', padding: 28, boxShadow: '0 12px 40px rgba(2,6,23,0.08)', overflow: 'hidden' }}>
        <h2 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>Live Road Quality Map</h2>
        <p style={{ fontSize: 18, opacity: 0.95, marginBottom: 16 }}>Monitoring India’s highways in real‑time.</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <Button variant="primary">View Live Map</Button>
          <Button variant="ghost">Upload Data</Button>
        </div>
      </div>
    </section>
  )
}
