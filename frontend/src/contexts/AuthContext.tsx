/* @refresh reset */
import React, { createContext, useContext, useEffect, useState } from 'react';

export type Role = 'CITIZEN' | 'CE' | 'EE' | 'CONTRACTOR' | 'SUPER_ADMIN';

export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  username?: string;
  role: Role;
  fabricVerified: boolean;
  districts?: string[];
  zones?: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  setUser: (user: AuthUser | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function normalizeRole(role: Role | string) {
    if (!role) return 'citizen'
    const r = String(role).toUpperCase()
    if (r === 'CONTRACTOR') return 'contractor'
    if (r === 'CITIZEN') return 'citizen'
    // CE/EE and other authority variants map to authority
    return 'authority'
  }

  // Load auth from localStorage on mount and validate/refresh with API
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      const storedToken = localStorage.getItem('roadwatch_token');
      const storedUser = localStorage.getItem('roadwatch_user');
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';

      if (storedToken && storedUser) {
        try {
          // Validate token with backend
          const response = await fetch(`${apiBase}/auth/me`, {
            headers: {
              'Authorization': `Bearer ${storedToken}`,
              'Content-Type': 'application/json'
            }
          });

          if (response.ok) {
            const userData = await response.json();
            if (mounted) {
              setToken(storedToken);
              setUser(userData);
            }
          } else if (response.status === 401) {
            // Token expired, try to refresh
            const refreshResponse = await fetch(`${apiBase}/auth/refresh`, {
              method: 'POST',
              credentials: 'include' // Include refresh token cookie
            });

            if (refreshResponse.ok) {
              const { token: newToken, user: refreshedUser } = await refreshResponse.json();
              if (mounted) {
                localStorage.setItem('roadwatch_token', newToken);
                localStorage.setItem('roadwatch_user', JSON.stringify(refreshedUser));
                setToken(newToken);
                setUser(refreshedUser);
              }
            } else {
              // Refresh failed, clear auth
              if (mounted) {
                localStorage.removeItem('roadwatch_token');
                localStorage.removeItem('roadwatch_user');
                setToken(null);
                setUser(null);
              }
            }
          }
        } catch (error) {
          console.error('Auth validation failed:', error);
          if (mounted) {
            // Keep stored auth for offline usage
            try {
              const parsedUser = JSON.parse(storedUser);
              setToken(storedToken);
              setUser(parsedUser);
            } catch (parseError) {
              localStorage.removeItem('roadwatch_token');
              localStorage.removeItem('roadwatch_user');
            }
          }
        }
      }

      if (mounted) {
        setLoading(false);
      }
    }

    initAuth();

    return () => {
      mounted = false;
    };
  }, []);


  const login = (newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('roadwatch_token', newToken);
    localStorage.setItem('roadwatch_user', JSON.stringify(newUser));
    localStorage.setItem('roadwatch_role', normalizeRole(newUser.role));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('roadwatch_token');
    localStorage.removeItem('roadwatch_user');
    localStorage.removeItem('roadwatch_role');
    localStorage.removeItem('roadwatch_authority_id');
    localStorage.removeItem('roadwatch_contractor_id');
  };

  const updateUser = (newUser: AuthUser | null) => {
    setUser(newUser);
    if (newUser) {
      localStorage.setItem('roadwatch_user', JSON.stringify(newUser));
      localStorage.setItem('roadwatch_role', normalizeRole(newUser.role));
    } else {
      localStorage.removeItem('roadwatch_user');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: !!token && !!user,
        login,
        logout,
        setUser: updateUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

/**
 * Hook to fetch current user from API
 */
export function useCurrentUser() {
  const { user, token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const response = await fetch(`${apiBase}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch user');
      }

      const data = await response.json();
      return data.user;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch user';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { user, token, loading, error, fetchUser };
}
