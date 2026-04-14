import { JWTAuthProvider } from './JWTAuthProvider';

/**
 * Raw PostgreSQL Provider Backend Interface Wrapper.
 * Sits logically above simple fetch operations enforcing rigid standard headers, 
 * robust JWT rotation algorithms universally preventing silent network token decays.
 */
export class BackendAPIClient {
  constructor(
    private readonly baseUrl: string, 
    private readonly authProvider: JWTAuthProvider
  ) {}

  /**
   * Evaluates standard explicit Read queries (Materialized Views fetching) efficiently.
   */
  public async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  /**
   * Translates local logic arrays directly to Backend Node execution routes natively.
   */
  public async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  /**
   * Automatically executes the generic HTTP cycle dynamically enforcing rotating tokens.
   */
  private async request<T>(path: string, options: RequestInit, retryCount = 0): Promise<T> {
    const token = await this.authProvider.getAuthToken();
    const headers = new Headers(options.headers || {});
    
    headers.set('Content-Type', 'application/json');
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers });

    // Logical Automatic 401 Token Rotation Intercept Hook
    if (response.status === 401 && retryCount < 1) {
       console.warn(`[API Client]: Access Token Expired dynamically for route ${path}. Commencing Rotation Protocol.`);
       const refreshedToken = await this.authProvider.refreshToken();
       
       if (refreshedToken) {
           return this.request<T>(path, options, retryCount + 1);
       }
    }

    if (!response.ok) {
       let errorMsg = `API Mathematical Fault: ${response.status}`;
       try {
           const body = await response.json();
           errorMsg = body.message || errorMsg;
       } catch { /* Suppress non-json strings safely */ }
       
       throw new Error(errorMsg);
    }

    return response.json() as Promise<T>;
  }
}
