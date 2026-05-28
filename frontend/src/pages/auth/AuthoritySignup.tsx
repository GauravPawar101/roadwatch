import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, type AuthUser } from '../../contexts/AuthContext';

export default function AuthoritySignup() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    phone: '',
    fabricCertPem: '',
    fabricMspId: '',
    fabricOrgName: ''
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (name === 'password') {
      validatePassword(value);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.email || !formData.username) {
      setError('Email and username are required');
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

    if (!formData.fabricCertPem || !formData.fabricMspId) {
      setError('Fabric identity is required');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${apiBase}/auth/authority/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          username: formData.username,
          password: formData.password,
          phone: formData.phone || undefined,
          fabricCertPem: formData.fabricCertPem,
          fabricMspId: formData.fabricMspId,
          fabricOrgName: formData.fabricOrgName || 'Authority'
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Signup failed');
      }

      const user: AuthUser = {
        id: data.user.id,
        email: data.user.email,
        username: data.user.username,
        role: 'CE',
        fabricVerified: data.user.fabricVerified,
        districts: data.user.districts || [],
        zones: data.user.zones || []
      };

      login(data.token, user);
      localStorage.setItem('roadwatch_authority_id', data.user.username);
      navigate('/dashboard/authority');
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
            <span>CivicGuard</span>
          </div>
          <p className="mt-3 max-w-[26rem] text-[11px] leading-4 text-on-surface-variant sm:text-[12px] sm:leading-5">
            Create Authority Account
          </p>
        </div>

        <div className="flex flex-1 items-center justify-center py-10 sm:py-12">
          <div className="w-full max-w-[372px] rounded-[14px] border border-outline-variant bg-surface-container-lowest px-5 py-5 shadow-[0_1px_0_rgba(0,0,0,0.02)] sm:px-6 sm:py-6 text-center">
            <div className="rounded-[10px] border border-error/20 bg-error-container px-3 py-3 text-[13px] text-on-error-container">
              Authority accounts are provisioned by the administrator. There is no open signup path.
            </div>

            <div className="mt-4 text-[12px]">
              <a href="/" className="text-secondary transition-colors hover:text-primary hover:underline">Back to dashboard</a>
            </div>
          </div>
        </div>

        <footer className="absolute bottom-0 left-0 right-0 border-t border-outline-variant/60 bg-background/90 px-4 py-3 backdrop-blur-sm sm:px-6">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 text-[11px] text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
            <p>© 2024 CivicGuard Institutional Portal. All rights reserved.</p>
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
