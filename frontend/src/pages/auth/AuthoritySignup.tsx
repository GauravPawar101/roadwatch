import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Card, CardBody } from '../../components/UIComponents';
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 16px' }}>
      <div style={{ width: '100%', maxWidth: 540 }}>
        <Card>
          <CardBody>
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>RoadWatch</h1>
              <p style={{ color: 'var(--color-text-secondary)' }}>Create Authority Account</p>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Alert variant="warning">Authority accounts are provisioned by the administrator. There is no open signup path.</Alert>
            </div>

            <div style={{ marginTop: 12, textAlign: 'center', fontSize: 13, color: 'var(--color-text-secondary)' }}>
              <a href="/">Back to dashboard</a>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
