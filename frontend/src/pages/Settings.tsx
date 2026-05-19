import { useNavigate } from 'react-router-dom'
import {
    Badge,
    Button,
    Card,
    CardBody,
    Container,
    Divider,
    FormGroup,
    Hero,
    Input,
    Section,
    Select
} from '../components/UIComponents'

export default function Settings() {
  const navigate = useNavigate()
  const role = localStorage.getItem('roadwatch_role') || 'citizen'

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    localStorage.setItem('roadwatch_language', e.target.value)
    alert('✓ Language preference saved!')
  }

  const handleWalletUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    alert('✓ Wallet address updated!')
  }

  return (
    <Container>
      <Hero
        title="Settings"
        subtitle="Manage your preferences and account configuration"
      />

      {/* Account Info */}
      <Section title="Account Information">
        <Card interactive>
          <CardBody>
            <div className="stitch-grid-auto-fit-200">
              <div>
                <p className="stitch-text-12 stitch-text-muted">
                  Current Role
                </p>
                <Badge variant="primary">{role.charAt(0).toUpperCase() + role.slice(1)}</Badge>
              </div>
              <div>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-2)' }}>
                  Account Status
                </p>
                <Badge variant="success">✓ Active</Badge>
              </div>
            </div>
          </CardBody>
        </Card>
      </Section>

      {/* Preferences */}
      <Section title="Preferences">
        <Card interactive>
          <CardBody>
            <FormGroup label="Language" required>
              <Select
                options={[
                  { label: 'English', value: 'en' },
                  { label: 'हिन्दी (Hindi)', value: 'hi' },
                  { label: 'Tamil', value: 'ta' },
                  { label: 'Telugu', value: 'te' }
                ]}
                defaultValue="en"
                onChange={handleLanguageChange}
              />
              <p className="stitch-text-12 stitch-text-muted">
                Change the language for the application interface
              </p>
            </FormGroup>

            <Divider />

            <FormGroup label="Notifications" required>
              <Select
                options={[
                  { label: 'All notifications', value: 'all' },
                  { label: 'Important only', value: 'important' },
                  { label: 'Disabled', value: 'disabled' }
                ]}
                defaultValue="all"
              />
              <p className="stitch-text-12 stitch-text-muted">
                Control notification frequency
              </p>
            </FormGroup>

            <Divider />

            <FormGroup label="Theme">
              <Select
                options={[
                  { label: 'Light', value: 'light' },
                  { label: 'Dark', value: 'dark' },
                  { label: 'Auto', value: 'auto' }
                ]}
                defaultValue="light"
              />
              <p className="stitch-text-12 stitch-text-muted">
                Select your preferred color scheme
              </p>
            </FormGroup>
          </CardBody>
        </Card>
      </Section>

      {/* Offline & Sync */}
      <Section title="Offline & Sync">
        <Card interactive>
          <CardBody>
            <p className="stitch-text-muted">
              📱 Manage offline maps and data synchronization
            </p>
            <div className="stitch-display-flex stitch-gap-12 stitch-flex-wrap">
              <Button variant="primary">
                📥 Download Offline Map
              </Button>
              <Button variant="secondary">
                📊 View Sync Status
              </Button>
            </div>
            <Divider />
            <p className="stitch-text-12 stitch-text-muted">
              💾 Local storage: ~45 MB | Last sync: 2 hours ago
            </p>
          </CardBody>
        </Card>
      </Section>

      {/* Blockchain & Wallet */}
      <Section title="Blockchain & Wallet">
        <Card interactive>
          <CardBody>
            <form onSubmit={handleWalletUpdate}>
              <FormGroup
                label="Connected Wallet Address (Optional)"
                helperText="Connect your Web3 wallet to claim governance tokens"
              >
                <Input
                  type="text"
                  placeholder="0x..."
                  defaultValue=""
                />
              </FormGroup>
              <div className="stitch-display-flex stitch-gap-12">
                <Button variant="primary" type="submit">
                  ⛓️ Connect Wallet
                </Button>
                <Button variant="ghost">
                  📖 Learn More
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </Section>

      {/* Danger Zone */}
      <Section title="Danger Zone">
        <Card interactive>
          <CardBody>
            <div className="stitch-border-left-error">
              <p className="stitch-text-muted">
                These actions are permanent and cannot be undone.
              </p>
              <div className="stitch-display-flex stitch-gap-12 stitch-flex-wrap">
                <Button variant="secondary">
                  🗑️ Clear Local Data
                </Button>
                <Button variant="danger">
                  🚪 Logout
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </Section>

      {/* Navigation */}
      <div className="stitch-display-flex stitch-gap-12 stitch-mt-16 stitch-justify-end">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          ← Back
        </Button>
      </div>
    </Container>
  )
}

