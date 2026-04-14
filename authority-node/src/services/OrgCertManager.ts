import fs from 'fs/promises';
import path from 'path';

export class OrgCertManager {
  private certDir: string;
  constructor(certDir: string) {
    this.certDir = certDir;
  }

  async getCertAndKey(org: string): Promise<{ cert: string; key: string }> {
    // In production, use HSM or secure vault
    const cert = await fs.readFile(path.join(this.certDir, `${org}.cert.pem`), 'utf8');
    const key = await fs.readFile(path.join(this.certDir, `${org}.key.pem`), 'utf8');
    return { cert, key };
  }
}
