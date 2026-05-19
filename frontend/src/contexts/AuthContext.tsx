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
          const parsedUser = JSON.parse(storedUser);
          setToken(storedToken);
          setUser(parsedUser);
          // ensure stored normalized role is available for other parts of the app
          const norm = normalizeRole(parsedUser.role as string);
          if (localStorage.getItem('roadwatch_role') !== norm) {
            localStorage.setItem('roadwatch_role', norm);
          }
        } catch (e) {
          console.error('Failed to parse stored user:', e);
          localStorage.removeItem('roadwatch_token');
          localStorage.removeItem('roadwatch_user');
        }
      }

      try {
        // If we have a stored token, first validate it by calling /auth/me
        if (storedToken) {
          const meRes = await fetch(`${apiBase}/auth/me`, {
            headers: { Authorization: `Bearer ${storedToken}` }
          });
          if (meRes.ok) {
            const meData = await meRes.json();
            if (!mounted) return;
            setUser(meData.user);
            localStorage.setItem('roadwatch_user', JSON.stringify(meData.user));
            // ensure role is normalized
            localStorage.setItem('roadwatch_role', normalizeRole(meData.user.role));
            setLoading(false);
            return;
          }
          // if token invalid, try refresh
        }

        // Attempt silent refresh using HttpOnly refresh cookie
        const r = await fetch(`${apiBase}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (r.ok) {
          const data = await r.json();
          if (data && data.token) {
            if (!mounted) return;
            setToken(data.token as string);
            localStorage.setItem('roadwatch_token', data.token as string);

            // Fetch user info
            const me = await fetch(`${apiBase}/auth/me`, {
              headers: { Authorization: `Bearer ${data.token}` }
            });
            if (me.ok) {
              const meData = await me.json();
              setUser(meData.user);
              localStorage.setItem('roadwatch_user', JSON.stringify(meData.user));
              localStorage.setItem('roadwatch_role', normalizeRole(meData.user.role));
            }
          }
        } else {
          // refresh failed; clear local storage and state
          if (mounted) {
            setToken(null);
            setUser(null);
            localStorage.removeItem('roadwatch_token');
            localStorage.removeItem('roadwatch_user');
            localStorage.removeItem('roadwatch_role');
          }
        }
      } catch (e) {
        // ignore network errors
      } finally {
        if (mounted) setLoading(false);
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
