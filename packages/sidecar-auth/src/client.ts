import fetch from 'node-fetch';

export type ServiceInfo = {
  name: string;
  address: string;
  healthUrl?: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type ServiceRegistrationOptions = {
  name: string;
  address: string;
  healthUrl?: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export class SidecarAuthClient {
  private gatewayUrl: string;
  private registrationToken?: string;
  private serviceName: string;

  constructor(gatewayUrl: string, serviceName: string) {
    this.gatewayUrl = gatewayUrl.replace(/\/$/, '');
    this.serviceName = serviceName;
  }

  /**
   * Register this service using environment variables.
   */
  async registerFromEnv(overrides: Partial<ServiceRegistrationOptions> = {}): Promise<{ service: ServiceInfo; registrationToken: string }> {
    const name = overrides.name || process.env.SERVICE_NAME || this.serviceName;
    const address = overrides.address || process.env.SERVICE_URL;

    if (!address) {
      throw new Error('Service address is required. Provide overrides.address or set SERVICE_URL.');
    }

    const options: ServiceRegistrationOptions = {
      name,
      address,
      healthUrl: overrides.healthUrl,
      description: overrides.description,
      metadata: {
        env: process.env.NODE_ENV || 'development',
        ...(overrides.metadata || {})
      }
    };

    return this.registerService(options);
  }

  /**
   * Register this service with the gateway
   */
  async registerService(options: ServiceRegistrationOptions): Promise<{ service: ServiceInfo; registrationToken: string }> {
    const url = `${this.gatewayUrl}/services/register`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(options)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Service registration failed (${response.status}): ${error}`);
    }

    const result = await response.json() as { service: ServiceInfo; registrationToken: string };
    this.registrationToken = result.registrationToken;
    return result;
  }

  /**
   * Get information about a registered service
   */
  async getService(serviceName: string): Promise<ServiceInfo> {
    if (!this.registrationToken) {
      throw new Error('Service not registered. Call registerService() first.');
    }

    const url = `${this.gatewayUrl}/services/${encodeURIComponent(serviceName)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.registrationToken}`
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Get service failed (${response.status}): ${error}`);
    }

    const result = await response.json() as { service: ServiceInfo };
    return result.service;
  }

  /**
   * List all registered services.
   */
  async listServices(): Promise<ServiceInfo[]> {
    if (!this.registrationToken) {
      throw new Error('Service not registered. Call registerService() first.');
    }

    const url = `${this.gatewayUrl}/services`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.registrationToken}`
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`List services failed (${response.status}): ${error}`);
    }

    const result = await response.json() as { services: ServiceInfo[] };
    return result.services;
  }

  /**
   * Request an access token for calling another service
   */
  async getServiceAccessToken(
    targetService: string,
    options: {
      method?: string;
      path?: string;
      ttlSeconds?: number;
    } = {}
  ): Promise<{ service: ServiceInfo; token: string; expiresIn: number }> {
    if (!this.registrationToken) {
      throw new Error('Service not registered. Call registerService() first.');
    }

    const url = `${this.gatewayUrl}/services/${encodeURIComponent(targetService)}/token`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.registrationToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(options)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Get service access token failed (${response.status}): ${error}`);
    }

    return await response.json() as { service: ServiceInfo; token: string; expiresIn: number };
  }

  /**
   * Make an authenticated request to another service
   */
  async callService(
    targetService: string,
    options: {
      method?: string;
      path?: string;
      headers?: Record<string, string>;
      body?: unknown;
      ttlSeconds?: number;
    }
  ): Promise<Response> {
    const { service, token } = await this.getServiceAccessToken(targetService, {
      method: options.method,
      path: options.path,
      ttlSeconds: options.ttlSeconds
    });

    const url = `${service.address}${options.path || ''}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      ...options.headers
    };

    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    return fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  }

  /**
   * Get the registration token (for manual use)
   */
  getRegistrationToken(): string | undefined {
    return this.registrationToken;
  }

  /**
   * Set the registration token (if you have it from elsewhere)
   */
  setRegistrationToken(token: string): void {
    this.registrationToken = token;
  }
}