import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestCitizenOtp, requestOtp, verifyCitizenOtp, verifyOtp } from '../api';
import { setToken, setUser } from '../auth';

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'AUTHORITY' | 'CITIZEN'>('AUTHORITY');
  const [phone, setPhone] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="container">
      <h1>Sign in</h1>
      <div className="card" style={{ maxWidth: 460 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <button
            className={mode === 'AUTHORITY' ? undefined : 'secondary'}
            disabled={busy}
            onClick={() => {
              setMode('AUTHORITY');
              setSessionId(null);
              setOtp('');
              setDevCode(null);
              setError(null);
            }}
          >
            Authority / Admin
          </button>
          <button
            className={mode === 'CITIZEN' ? undefined : 'secondary'}
            disabled={busy}
            onClick={() => {
              setMode('CITIZEN');
              setSessionId(null);
              setOtp('');
              setDevCode(null);
              setError(null);
            }}
          >
            Citizen (Sign up)
          </button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div className="muted">Mobile number</div>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
        </div>

        {!sessionId ? (
          <button
            disabled={busy || phone.trim().length < 6}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = mode === 'CITIZEN' ? await requestCitizenOtp(phone.trim()) : await requestOtp(phone.trim());
                setSessionId(r.sessionId);
                setDevCode(r.devCode ?? null);
              } catch (e: any) {
                setError(e?.message ?? 'Failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            Send OTP
          </button>
        ) : (
          <>
            <div style={{ marginTop: 12, marginBottom: 12 }}>
              <div className="muted">OTP</div>
              <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit code" />
              {devCode ? <div className="muted" style={{ marginTop: 8 }}>Dev OTP: {devCode}</div> : null}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                disabled={busy || otp.trim().length < 4}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const r =
                      mode === 'CITIZEN'
                        ? await verifyCitizenOtp({ phone: phone.trim(), sessionId, code: otp.trim() })
                        : await verifyOtp({ phone: phone.trim(), sessionId, code: otp.trim() });
                    setToken(r.token);
                    setUser(r.user);
                    navigate(mode === 'CITIZEN' ? '/public' : '/queue');
                  } catch (e: any) {
                    setError(e?.message ?? 'Failed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Verify & Sign in
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setSessionId(null);
                  setOtp('');
                  setDevCode(null);
                }}
              >
                Restart
              </button>
            </div>
          </>
        )}

        {error ? <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div> : null}

        <div style={{ marginTop: 16 }}>
          <button className="secondary" onClick={() => navigate('/public')}>View public dashboard</button>
        </div>
      </div>
    </div>
  );
}
