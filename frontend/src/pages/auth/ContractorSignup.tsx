
import { Card, CardBody } from '../../components/UIComponents';

export default function ContractorSignup() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 16px' }}>
      <div style={{ width: '100%', maxWidth: 720, textAlign: 'center' }}>
        <Card>
          <CardBody>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Contractor signup is restricted</h1>
            <p style={{ color: 'var(--color-text-secondary)' }}>Contractor accounts are provisioned by the super administrator. There is no open signup path for Contractor users. Please contact your administrator to request an account.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
