import type { User } from '@roadwatch/core/src/domain/Entities';
import type { IAuthProvider } from '@roadwatch/core/src/interfaces/providers/ProviderInterfaces';

// Pure abstract local lockbox for natively saving React Native generic encrypted blobs structurally
export interface ISecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Standard Token Provider enforcing strict logical cryptographic barriers natively offline
 * before generating structural session streams physically against PG Backends.
 */
export class JWTAuthProvider implements IAuthProvider {
  private inMemoryAccessToken: string | null = null;
  private readonly ACCESS_KEY = 'roadwatch_jwt_access';
  private readonly REFRESH_KEY = 'roadwatch_jwt_refresh';

  constructor(
    private secureStorage: ISecureStorage, 
    private baseUrl: string
  ) {}

   async authenticateWithOTP(phone: string, otp: string): Promise<User> {
       return this.login({ phone, otp });
   }

   async getCurrentUser(): Promise<User | null> {
       const token = await this.getAuthToken();
       if (!token) return null;

       try {
          const response = await fetch(`${this.baseUrl}/auth/me`, {
             method: 'GET',
             headers: { Authorization: `Bearer ${token}` }
          });

          if (!response.ok) return null;
          return (await response.json()) as User;
       } catch {
          return null;
       }
   }

   async login(credentials: Record<string, string>): Promise<User> {
     // Expose generic login blocks straight into PG user stores logic
     const response = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
     });

     if (!response.ok) throw new Error("Cryptographic Logic Invalidated. Login Exception.");
     
     const data = await response.json();
     await this.storeTokens(data.access, data.refresh);
     
     return data.user as User;
  }

  async logout(): Promise<void> {
     this.inMemoryAccessToken = null;
     
     // Systematically shatters structural offline lockboxes wiping array tokens entirely
     await this.secureStorage.removeItem(this.ACCESS_KEY);
     await this.secureStorage.removeItem(this.REFRESH_KEY);
  }

  async getAuthToken(): Promise<string | null> {
     // Mathematical optimization to stop repetitive local encryption bridge calls sequentially
     if (this.inMemoryAccessToken) return this.inMemoryAccessToken;
     
     this.inMemoryAccessToken = await this.secureStorage.getItem(this.ACCESS_KEY);
     return this.inMemoryAccessToken;
  }

  /**
   * Extends IAuthProvider explicitly to enforce algorithmic Network session refreshes silently.
   */
  async refreshToken(): Promise<string | null> {
     const refresh = await this.secureStorage.getItem(this.REFRESH_KEY);
     if (!refresh) return null;

     const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh })
     });

     if (!response.ok) {
         // Logic lock explicitly wipes structures dynamically preventing dead lock states
         await this.logout();
         return null;
     }

     const data = await response.json();
     await this.storeTokens(data.access, data.refresh);
     return data.access;
  }

  private async storeTokens(access: string, refresh: string) {
     this.inMemoryAccessToken = access;
     await this.secureStorage.setItem(this.ACCESS_KEY, access);
     await this.secureStorage.setItem(this.REFRESH_KEY, refresh);
  }
}
