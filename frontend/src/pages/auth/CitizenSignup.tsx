import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, type AuthUser } from '../../contexts/AuthContext';

export default function CitizenSignup() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    phone: '',
    username: '',
    password: '',
    confirmPassword: '',
    name: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';

  const validatePassword = (pass: string) => {
    const errors: string[] = [];
    if (pass.length < 8) errors.push('At least 8 characters');
    if (!/[A-Z]/.test(pass)) errors.push('One uppercase letter');
    if (!/[a-z]/.test(pass)) errors.push('One lowercase letter');
    if (!/\d/.test(pass)) errors.push('One digit');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pass))
      errors.push('One special character');
    setPasswordErrors(errors);
    return errors.length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (name === 'password') {
      validatePassword(value);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate
    if (!formData.email && !formData.phone && !formData.username) {
      setError('Provide email, phone, or username');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (passwordErrors.length > 0) {
      setError('Password does not meet requirements');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${apiBase}/auth/citizen/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          username: formData.username || undefined,
          password: formData.password,
          name: formData.name || undefined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Signup failed');
      }

      const user: AuthUser = {
        id: data.user.id,
        email: data.user.email,
        phone: data.user.phone,
        username: data.user.username,
        role: 'CITIZEN',
        fabricVerified: false
      };

      login(data.token, user);
      navigate('/dashboard/citizen');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-on-background relative overflow-hidden">
      <main className="relative z-10 flex min-h-screen flex-col items-center px-4 pt-8 pb-24 sm:pt-10 sm:pb-20">
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-on-surface-variant">
            <span className="h-1.5 w-1.5 rounded-full bg-on-surface-variant" aria-hidden="true" />
            <span>RoadWatch</span>
          </div>
          <p className="mt-3 max-w-[26rem] text-[11px] leading-4 text-on-surface-variant sm:text-[12px] sm:leading-5">
            Join the infrastructure transparency movement as a Citizen.
          </p>
        </div>

        <div className="flex flex-1 items-center justify-center py-10 sm:py-12">
          <div className="w-full max-w-[372px] rounded-[14px] border border-outline-variant bg-surface-container-lowest px-5 py-5 shadow-[0_1px_0_rgba(0,0,0,0.02)] sm:px-6 sm:py-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-3">
                {[
                  { label: 'Email (optional)', name: 'email', type: 'email', placeholder: 'you@gmail.com' },
                  { label: 'Phone (optional)', name: 'phone', type: 'tel', placeholder: '9876543210' },
                  { label: 'Username (optional)', name: 'username', type: 'text', placeholder: 'username' },
                  { label: 'Name (optional)', name: 'name', type: 'text', placeholder: 'Your name' },
                ].map((field) => (
                  <div key={field.name} className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium tracking-[0.08em] text-on-surface-variant" htmlFor={field.name}>{field.label}</label>
                    <input
                      id={field.name}
                        className="h-10 w-full rounded-[10px] border border-outline-variant bg-surface-container-lowest px-3 text-[13px] text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-1 focus:ring-primary"
                      type={field.type}
                      name={field.name}
                      value={formData[field.name as keyof typeof formData]}
                      onChange={handleChange}
                      placeholder={field.placeholder}
                      disabled={loading}
                    />
                  </div>
                ))}

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium tracking-[0.08em] text-on-surface-variant" htmlFor="password">Password</label>
                  <input
                    id="password"
                      className="h-10 w-full rounded-[10px] border border-outline-variant bg-surface-container-lowest px-3 text-[13px] text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-1 focus:ring-primary"
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    disabled={loading}
                  />
                  {passwordErrors.length > 0 && (
                    <div className="rounded-[10px] border border-error/20 bg-error-container px-3 py-3 text-[12px] text-on-error-container">
                      <div className="font-semibold">Password must have:</div>
                      <ul className="mt-1 space-y-1">
                        {passwordErrors.map((err, i) => <li key={i}>• {err}</li>)}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium tracking-[0.08em] text-on-surface-variant" htmlFor="confirmPassword">Confirm Password</label>
                  <input
                    id="confirmPassword"
                      className="h-10 w-full rounded-[10px] border border-outline-variant bg-surface-container-lowest px-3 text-[13px] text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-1 focus:ring-primary"
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="••••••••"
                    disabled={loading}
                  />
                </div>
              </div>

              {error && <div className="rounded-[10px] border border-error/20 bg-error-container px-3 py-3 text-[13px] text-on-error-container">{error}</div>}

              <button
                className="flex h-11 w-full items-center justify-center rounded-[10px] bg-primary text-[13px] font-semibold text-on-primary transition-opacity hover:opacity-95 disabled:opacity-60"
                type="submit"
                disabled={loading}
              >
                {loading ? 'Creating Account...' : 'Create Citizen Account'}
              </button>
            </form>

            <div className="mt-5 border-t border-outline-variant/70 pt-4 text-center text-[12px] leading-5 text-on-surface-variant">
              Already have an account?
              <Link to="/auth/citizen/login" className="ml-1 font-medium text-secondary transition-colors hover:text-primary hover:underline">Sign In</Link>
            </div>
          </div>
        </div>

        <footer className="absolute bottom-0 left-0 right-0 border-t border-outline-variant/60 bg-background/90 px-4 py-3 backdrop-blur-sm sm:px-6">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 text-[11px] text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
            <p>© 2024 RoadWatch Institutional Portal. All rights reserved.</p>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:justify-end">
              <a className="transition-colors hover:text-primary" href="#">Help Center</a>
              <a className="transition-colors hover:text-primary" href="#">Privacy Policy</a>
              <a className="transition-colors hover:text-primary" href="#">Legal Disclosure</a>
            </nav>
          </div>
        </footer>
      </main>
    </div>
  );
}