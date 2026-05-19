import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, CardBody, Container, Hero, Input, ProgressBar } from '../components/UIComponents'

const languages = [
  { label: 'English', value: 'en' },
  { label: 'हिन्दी', value: 'hi' },
  { label: 'தமிழ்', value: 'ta' },
]

const interests = ['Report issues', 'View analytics', 'Help authority', 'Earn tokens', 'Community updates', 'Education']

export default function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [language, setLanguage] = useState('en')
  const [selectedInterests, setSelectedInterests] = useState<string[]>([])

  const totalSteps = 3
  const progress = (step / totalSteps) * 100

  function toggleInterest(interest: string) {
    setSelectedInterests((prev) =>
      prev.includes(interest) ? prev.filter((item) => item !== interest) : [...prev, interest]
    )
  }

  function complete() {
    localStorage.setItem('roadwatch_seen_onboarding', '1')
    localStorage.setItem('roadwatch_name', name)
    localStorage.setItem('roadwatch_phone', phone)
    localStorage.setItem('roadwatch_language', language)
    localStorage.setItem('roadwatch_interests', JSON.stringify(selectedInterests))
    navigate('/')
  }

  return (
    <Container className="min-h-screen" maxWidth="960px">
      <Hero title="Set up your civic dashboard in under a minute." subtitle="Choose how you want to use RoadWatch and personalize updates." />

      <Card>
        <CardBody>
          <div className="stitch-display-flex stitch-justify-between stitch-items-center">
            <div>Step {step} of {totalSteps}</div>
            <div>{Math.round(progress)}%</div>
          </div>

          <div className="stitch-mt-8">
            <ProgressBar progress={progress} showLabel={false} />
          </div>

          <div style={{ marginTop: 16 }}>
            {step === 1 && (
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700 }}>Welcome</h2>
                <p style={{ color: 'var(--color-text-secondary)', marginTop: 8 }}>RoadWatch helps citizens report road damage and lets teams respond with traceable proof.</p>
                <div className="stitch-grid stitch-gap-12" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 12 }}>
                  {[
                    ['Fast reporting', 'Capture issues with photos and location'],
                    ['Proof backed', 'Track verification and repair status'],
                    ['Role aware', 'Citizen, authority, and contractor flows'],
                  ].map(([title, body]) => (
                    <div key={title} style={{ padding: 12, borderRadius: 12, background: 'var(--card-hero)' }}>
                      <div style={{ fontWeight: 700 }}>{title}</div>
                      <div style={{ marginTop: 6, color: 'var(--color-text-secondary)' }}>{body}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700 }}>Your profile</h2>
                <div style={{ marginTop: 12 }}>
                  <label style={{ display: 'block', marginBottom: 8 }}>
                    <div style={{ marginBottom: 6 }}>Full name</div>
                    <Input value={name} onChange={(e:any) => setName(e.target.value)} placeholder="Enter your name" />
                  </label>
                  <label style={{ display: 'block', marginBottom: 8 }}>
                    <div style={{ marginBottom: 6 }}>Phone number</div>
                    <Input value={phone} onChange={(e:any) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
                  </label>
                  <label style={{ display: 'block' }}>
                    <div style={{ marginBottom: 6 }}>Preferred language</div>
                    <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--color-border)' }}>
                      {languages.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700 }}>What interests you?</h2>
                <p style={{ color: 'var(--color-text-secondary)', marginTop: 8 }}>Pick a few areas you want to focus on. This is optional.</p>
                <div className="stitch-display-flex stitch-gap-8 stitch-flex-wrap stitch-mt-12">
                  {interests.map((interest) => {
                    const active = selectedInterests.includes(interest)
                    return (
                      <Button key={interest} variant={active ? 'primary' : 'ghost'} onClick={() => toggleInterest(interest)}>{active ? '✓ ' : ''}{interest}</Button>
                    )
                  })}
                </div>
                <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'var(--card-bg)', color: 'var(--color-text-secondary)' }}>Your data stays private and only supports the reporting flow you choose.</div>
              </div>
            )}
          </div>

          <div className="stitch-display-flex stitch-justify-between stitch-mt-16">
            <Button onClick={() => setStep((c) => Math.max(1, c - 1))} variant="ghost" disabled={step === 1}>Back</Button>
            {step < totalSteps ? (
              <Button onClick={() => setStep((c) => c + 1)} variant="primary" disabled={step === 2 && (!name || !phone)}>Next</Button>
            ) : (
              <Button onClick={complete} variant="primary">Get started</Button>
            )}
          </div>
        </CardBody>
      </Card>
    </Container>
  )
}
