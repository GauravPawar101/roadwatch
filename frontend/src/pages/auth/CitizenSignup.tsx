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
    <div className="bg-background text-on-background min-h-screen flex flex-col items-center justify-center relative overflow-hidden p-4">
      <div className="absolute inset-0 z-0 opacity-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] rounded-full bg-primary-container blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] rounded-full bg-secondary-container blur-[120px]"></div>
      </div>

      <main className="relative z-10 w-full max-w-[540px]">
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-16 h-16 bg-primary text-on-primary rounded-xl flex items-center justify-center mb-6 shadow-sm">
            <span className="material-symbols-outlined text-[32px]">person_add</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">Create Account</h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-[320px]">
            Join the infrastructure transparency movement as a Citizen.
          </p>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant p-8 md:p-10 rounded-xl shadow-[0px_4px_20px_rgba(0,0,0,0.05)]">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="font-label-md text-label-md text-on-surface">Email (optional)</label>
                <input 
                  className="w-full bg-surface-container-lowest border border-outline rounded-xl py-3 pl-4 pr-4 text-body-md font-body-md focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all" 
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="you@gmail.com"
                  disabled={loading}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-label-md text-label-md text-on-surface">Phone (optional)</label>
                <input 
                  className="w-full bg-surface-container-lowest border border-outline rounded-xl py-3 pl-4 pr-4 text-body-md font-body-md focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all" 
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="9876543210"
                  disabled={loading}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-label-md text-label-md text-on-surface">Username (optional)</label>
                <input 
                  className="w-full bg-surface-container-lowest border border-outline rounded-xl py-3 pl-4 pr-4 text-body-md font-body-md focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all" 
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  placeholder="username"
                  disabled={loading}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-label-md text-label-md text-on-surface">Name (optional)</label>
                <input 
                  className="w-full bg-surface-container-lowest border border-outline rounded-xl py-3 pl-4 pr-4 text-body-md font-body-md focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all" 
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Your name"
                  disabled={loading}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-label-md text-label-md text-on-surface">Password <span className="text-error">*</span></label>
                <input 
                  className="w-full bg-surface-container-lowest border border-outline rounded-xl py-3 pl-4 pr-4 text-body-md font-body-md focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all" 
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  disabled={loading}
                />
                {passwordErrors.length > 0 && (
                  <div className="mt-2 p-3 bg-error-container rounded-lg">
                    <div className="font-label-md text-on-error-container font-bold mb-2">Password must have:</div>
                    <ul className="text-body-sm text-on-error-container space-y-1">
                      {passwordErrors.map((err, i) => (
                        <li key={i}>• {err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-label-md text-label-md text-on-surface">Confirm Password <span className="text-error">*</span></label>
                <input 
                  className="w-full bg-surface-container-lowest border border-outline rounded-xl py-3 pl-4 pr-4 text-body-md font-body-md focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all" 
                  type="password"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="••••••••"
                  disabled={loading}
                />
              </div>
            </div>

            {error && (
              <div className="bg-error-container border border-error/20 p-4 rounded-xl flex items-start gap-3">
                <span className="material-symbols-outlined text-error text-[20px]">error_outline</span>
                <p className="font-body-sm text-body-sm text-on-error-container">
                  {error}
                </p>
              </div>
            )}

            <button 
              className="w-full bg-primary text-on-primary font-headline-sm text-headline-sm py-4 rounded-xl shadow-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Creating Account...' : 'Create Citizen Account'}
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-outline-variant text-center">
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Already have an account?
              <Link to="/auth/citizen/login" className="text-secondary font-semibold hover:underline ml-1">Sign In</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}