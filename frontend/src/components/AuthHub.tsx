import React, { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Alert, Button, FormGroup, Input } from './UIComponents'

type Role = 'citizen' | 'authority' | 'contractor'

const roleCards: Array<{
  role: Role
  title: string
  description: string
  action: string
}> = [
  {
    role: 'citizen',
    title: 'Citizen',
    description: 'Report road issues, track complaints, and verify repair progress.',
    action: 'Enter citizen dashboard',
  },
  {
    role: 'authority',
    title: 'Authority',
    description: 'Assign inspectors, review escalations, and manage resolutions.',
    action: 'Enter authority console',
  },
  {
    role: 'contractor',
    title: 'Contractor',
    description: 'View assigned roads, upload proof, and manage project delivery.',
    action: 'Enter contractor workspace',
  },
]

function CitizenInlineSignIn({ nextParam }: { nextParam?: string }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = ((import.meta as any).env?.VITE_API_BASE as string | undefined) || 'http://localhost:3100';

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/citizen/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      login(data.token, { id: data.user.id, email: data.user.email, phone: data.user.phone, username: data.user.username, role: 'CITIZEN', fabricVerified: false });
      navigate(nextParam || '/dashboard/citizen');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <FormGroup label="Email / phone / username">
        <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="email / phone / username" />
      </FormGroup>
      <FormGroup label="Password">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
      </FormGroup>
      <div className="stitch-display-flex stitch-gap-8">
        <Button type="submit" variant="primary" loading={loading}>{loading ? 'Signing in...' : 'Sign in'}</Button>
        <Button type="button" variant="ghost" onClick={() => navigate('/auth/citizen/signup')}>Create account</Button>
      </div>
    </form>
  );
}

function CitizenInlineSignUp({ nextParam }: { nextParam?: string }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = ((import.meta as any).env?.VITE_API_BASE as string | undefined) || 'http://localhost:3100';

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (password !== confirm) return setError('Passwords do not match');
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/citizen/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email || undefined, phone: phone || undefined, username: username || undefined, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Signup failed');
      login(data.token, { id: data.user.id, email: data.user.email, phone: data.user.phone, username: data.user.username, role: 'CITIZEN', fabricVerified: false });
      navigate(nextParam || '/dashboard/citizen');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <FormGroup label="Email (optional)">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" />
      </FormGroup>
      <FormGroup label="Phone (optional)">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" />
      </FormGroup>
      <FormGroup label="Username (optional)">
        <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username (optional)" />
      </FormGroup>
      <FormGroup label="Password">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
      </FormGroup>
      <FormGroup label="Confirm Password">
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm Password" />
      </FormGroup>
      <div className="stitch-display-flex stitch-gap-8">
        <Button type="submit" variant="primary" loading={loading}>{loading ? 'Creating...' : 'Create account'}</Button>
        <Button type="button" variant="ghost" onClick={() => navigate('/auth/citizen/login')}>Sign in</Button>
      </div>
    </form>
  );
}


export default function AuthHub({ presetRole = 'citizen' }: { presetRole?: Role }) {
  const navigate = useNavigate()
  const [role, setRole] = useState<Role>(() => {
    try {
      const stored = localStorage.getItem('roadwatch_role')
      if (stored === 'citizen' || stored === 'authority' || stored === 'contractor') return stored as Role
    } catch (e) {
      // ignore
    }
    return presetRole
  })
  const [citizenMode, setCitizenMode] = useState<'signin' | 'signup'>('signin')
  const [identifier, setIdentifier] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [code, setCode] = useState('')
  const [staffStatus, setStaffStatus] = useState('')
  const [staffError, setStaffError] = useState('')
  const [staffLoading, setStaffLoading] = useState(false)

  const apiBase = ((import.meta as any).env?.VITE_API_BASE as string | undefined) || 'http://localhost:3100'
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const nextParam = search.get('next') || '';

  const selectedRoleCard = useMemo(
    () => roleCards.find((card) => card.role === role) ?? roleCards[0],
    [role]
  )

  const { user } = useAuth();

  const isCitizen = role === 'citizen'
  const isStaffRole = role === 'authority' || role === 'contractor'

  function continueToRole(nextRole: Role) {
    localStorage.setItem('roadwatch_role', nextRole)
    if (nextRole !== 'citizen') {
      localStorage.removeItem('roadwatch_token')
    }
    const dest = nextParam || (nextRole === 'authority' ? '/dashboard/authority' : nextRole === 'contractor' ? '/dashboard/contractor' : '/dashboard/citizen')
    if (nextRole === 'authority') {
      localStorage.setItem('roadwatch_authority_id', 'Local PWD')
    }
    if (nextRole === 'contractor') {
      localStorage.setItem('roadwatch_contractor_id', 'SuperBuild Infra')
    }
    navigate(dest)
  }

  function getStaffOtpPath() {
    return role === 'authority' ? '/auth/authority/otp' : '/auth/contractor/otp'
  }

  async function requestStaffOtp() {
    setStaffError('')
    setStaffStatus('')

    const cleanedIdentifier = identifier.trim()
    if (!cleanedIdentifier) {
      setStaffError('Enter your assigned username, email, or phone number.')
      return
    }

    setStaffLoading(true)
    try {
      const response = await fetch(`${apiBase}${getStaffOtpPath()}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanedIdentifier })
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Could not send verification code')
      }

      setSessionId(payload.sessionId)
      setCode(payload.devCode || '')
      setStaffStatus('Verification code sent. Enter the OTP to finish sign in.')
    } catch (error) {
      setStaffError(error instanceof Error ? error.message : 'Unable to request OTP')
    } finally {
      setStaffLoading(false)
    }
  }

  async function verifyStaffOtp() {
    setStaffError('')
    setStaffStatus('')

    const cleanedIdentifier = identifier.trim()
    if (!cleanedIdentifier || !sessionId || !code.trim()) {
      setStaffError('Request an OTP first, then enter the code sent for your assigned account.')
      return
    }

    setStaffLoading(true)
    try {
      const response = await fetch(`${apiBase}${getStaffOtpPath()}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanedIdentifier, sessionId, code: code.trim() })
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Invalid OTP')
      }

      localStorage.setItem('roadwatch_role', role)
      localStorage.setItem('roadwatch_token', payload.token)
      const displayId = payload.user?.username || payload.user?.email || payload.user?.phone || cleanedIdentifier
      if (role === 'authority') {
        localStorage.setItem('roadwatch_authority_id', displayId)
      }
      if (role === 'contractor') {
        localStorage.setItem('roadwatch_contractor_id', displayId)
      }

      setStaffStatus('Signed in successfully. Redirecting...')
      const dest = nextParam || (role === 'authority' ? '/dashboard/authority' : '/dashboard/contractor')
      navigate(dest)
    } catch (error) {
      setStaffError(error instanceof Error ? error.message : 'Unable to verify OTP')
    } finally {
      setStaffLoading(false)
    }
  }

  return (
    <div className="page-radial-bg stitch-minh-100vh p-lg text-on-surface">
      <div className="stitch-maxw-1100 grid-two-col">
        <section className="relative overflow-hidden rounded-xl p-md shadow-lg glass-panel" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(244,243,247,0.98))' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at top right, rgba(0,32,69,0.08), transparent 25%), radial-gradient(circle at bottom left, rgba(81,95,116,0.05), transparent 28%)' }} />
          <div className="relative" style={{ zIndex: 1 }}>
            <div className="chip">
              {isCitizen ? 'Citizen Clerk access' : 'Assigned staff access'}
            </div>
            <div className="stitch-mt-12">
              <h1 className="headline-md" style={{ fontWeight: 900, lineHeight: 1.05, color: '#1a1b1e' }}>
                {isCitizen
                  ? 'Sign in or create a citizen account with Clerk.'
                  : 'Sign in with your assigned username, Gmail, or phone number.'}
              </h1>
              <p className="body-lg stitch-mt-12" style={{ color: '#44474e' }}>
                {isCitizen
                  ? 'Citizens can use Clerk sign-in or sign-up. Staff roles do not get a sign-up path and must use the access code assigned by the super user.'
                  : 'Authority and contractor accounts are sign-in only. Your identifier is assigned by the super user and verified by the gateway API.'}
              </p>
            </div>

            <div className="grid-3cols stitch-mt-18">
              {[
                isCitizen ? ['Google', 'One-click social sign-in'] : ['Assigned username', 'Approved by the super user'],
                isCitizen ? ['Gmail / email', 'Common account option'] : ['Gmail / phone', 'Verified against the gateway'],
                isCitizen ? ['Citizen access', 'Sign up or sign in'] : ['No sign-up', 'Sign in only for staff roles'],
              ].map(([title, body]) => (
                <div key={title} className="glass-card p-sm rounded-12">
                  <div className="stitch-font-700">{title}</div>
                  <div className="stitch-mt-6 text-on-surface-variant">{body}</div>
                </div>
              ))}
            </div>

            <div className="glass-card p-md stitch-mt-16">
              <div className="muted-upper">Role selection happens here</div>
              <div className="stitch-mt-8 title-lg stitch-font-800 text-on-surface">{selectedRoleCard.title}</div>
              <p className="stitch-mt-8 text-on-surface-variant">{selectedRoleCard.description}</p>
            </div>
          </div>
        </section>

        <section className="glass-panel p-md rounded-xl">
            <div className="stitch-display-flex stitch-justify-between stitch-items-center">
            <div>
              <div className="muted-upper">Account access</div>
              <h2 className="title-lg stitch-mt-2 text-on-surface">Choose your role here, then sign in</h2>
            </div>
            <div className="rounded-full stitch-p-8 stitch-font-700" style={{ background: 'var(--surface-container)', color: 'var(--primary)', fontSize: 12 }}>{isCitizen ? 'Clerk-enabled' : 'No sign-up'}</div>
          </div>

          <div className="stitch-mt-16" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {roleCards.map((card) => (
              <Button key={card.role} type="button" variant={role === card.role ? 'primary' : 'ghost'} onClick={() => setRole(card.role)}>{card.title}</Button>
            ))}
          </div>

          <div className="glass-card p-sm stitch-mt-16">
            <div className="text-on-surface-variant">
            {isCitizen
              ? 'Role switching is only available on this login screen. Clerk handles citizen sign-in and sign-up. Enable the social and email providers in your Clerk dashboard.'
              : 'Role switching is only available on this login screen. Authority and contractor access comes from the gateway API. No sign-up screen is shown for these roles.'}
            </div>
          </div>

          <div className="glass-card" style={{ marginTop: 16, overflow: 'hidden' }}>
            {isCitizen ? (
              <div className="p-sm">
                <div className="stitch-display-flex stitch-gap-8" style={{ borderRadius: 9999, border: '1px solid var(--color-border)', background: 'var(--surface-container-low)', padding: 6, marginBottom: 12 }}>
                  <Button type="button" variant={citizenMode === 'signin' ? 'primary' : 'ghost'} onClick={() => setCitizenMode('signin')}>Sign in</Button>
                  <Button type="button" variant={citizenMode === 'signup' ? 'primary' : 'ghost'} onClick={() => setCitizenMode('signup')}>Sign up</Button>
                </div>

                {citizenMode === 'signin' ? (
                  <CitizenInlineSignIn nextParam={nextParam} />
                ) : (
                  <CitizenInlineSignUp nextParam={nextParam} />
                )}
              </div>
            ) : (
              <div style={{ padding: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormGroup label="Assigned username, email, or phone">
                    <Input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="example.user / user@gmail.com / +91..." />
                  </FormGroup>

                  <FormGroup label="OTP code">
                    <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Enter the code you received" />
                  </FormGroup>
                </div>

                <div className="stitch-display-flex stitch-gap-8 stitch-mt-12">
                  <Button type="button" onClick={requestStaffOtp} loading={staffLoading} variant="primary">{staffLoading ? 'Sending code...' : 'Send OTP'}</Button>
                  <Button type="button" onClick={verifyStaffOtp} disabled={staffLoading || !sessionId} variant="ghost">{staffLoading ? 'Verifying...' : 'Verify and sign in'}</Button>
                </div>

                <div className="glass-card p-sm stitch-mt-12 text-on-surface-variant">
                  Staff sign-up is disabled. Use the identifier assigned by the super user. If you were given an email, username, or phone number, enter it exactly as assigned.
                </div>

                {staffStatus ? <Alert variant="success">{staffStatus}</Alert> : null}
                {staffError ? <Alert variant="error">{staffError}</Alert> : null}
                {sessionId ? <div className="caption stitch-mt-8 text-on-surface-variant">Session: {sessionId}</div> : null}
              </div>
            )}
          </div>

          {isCitizen ? (
            user && user.role === 'CITIZEN' ? (
              <div style={{ marginTop: 16, borderRadius: 16, border: '1px solid var(--color-border)', background: 'var(--surface-container-low)', padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#64748b', fontWeight: 700 }}>Signed in</div>
                    <p style={{ marginTop: 8, color: '#44474e' }}>Continue into the citizen dashboard.</p>
                  </div>
                  <div style={{ fontSize: 14 }}>{user?.username || user?.email || user?.phone}</div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <Button type="button" onClick={() => continueToRole('citizen')} variant="ghost">Open citizen dashboard</Button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 16, borderRadius: 16, border: '1px solid var(--color-border)', background: 'var(--surface-container-low)', padding: 12 }}>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#64748b', fontWeight: 700 }}>Not signed in</div>
                <p style={{ marginTop: 8, color: '#44474e' }}>Sign in or create an account to continue as a citizen.</p>
              </div>
            )
          ) : (
            <div style={{ marginTop: 16, borderRadius: 16, border: '1px solid var(--color-border)', background: 'var(--surface-container-low)', padding: 12 }}>
              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#64748b', fontWeight: 700 }}>Assigned access</div>
              <p style={{ marginTop: 8, color: '#44474e' }}>The account must already exist. There is no sign-up path for staff roles.</p>
            </div>
          )}

          <div style={{ marginTop: 16, borderRadius: 12, border: '1px solid var(--color-border)', background: 'var(--surface-container-low)', padding: 12, color: '#44474e' }}>
            {isCitizen ? (
              <span>Once you sign in, you can continue as {selectedRoleCard.title.toLowerCase()} without needing a mobile-only OTP flow.</span>
            ) : (
              <span>Staff access is restricted to assigned accounts only.</span>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}