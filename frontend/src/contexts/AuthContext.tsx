/* @refresh reset */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { isOfflineToken, parseStoredUser } from '../lib/authRedirect';

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

function normalizeRole(role: Role | string) {
  if (!role) return 'citizen';
  const r = String(role).toUpperCase();
  if (r === 'CONTRACTOR') return 'contractor';
  if (r === 'CITIZEN') return 'citizen';
  return 'authority';
}

function normalizeUser(data: unknown): AuthUser | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const nested = record.user;
  const source = nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : record;
  if (!source.id || !source.role) return null;
  return {
    id: String(source.id),
    email: source.email ? String(source.email) : undefined,
    phone: source.phone ? String(source.phone) : undefined,
    username: source.username ? String(source.username) : undefined,
    role: String(source.role).toUpperCase() as Role,
    fabricVerified: Boolean(source.fabricVerified),
    districts: Array.isArray(source.districts) ? source.districts.map(String) : undefined,
    zones: Array.isArray(source.zones) ? source.zones.map(String) : undefined,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem('roadwatch_user');
    return parseStoredUser(stored);
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('roadwatch_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      const storedToken = localStorage.getItem('roadwatch_token');
      const storedUser = parseStoredUser(localStorage.getItem('roadwatch_user'));

      if (!storedToken || !storedUser) {
        if (mounted) setLoading(false);
        return;
      }

      // Restore session immediately so navigation/back works while we validate
      if (mounted) {
        setToken(storedToken);
        setUser(storedUser);
      }

      // Offline/demo tokens — keep local session, skip API validation
      if (isOfflineToken(storedToken)) {
        if (mounted) setLoading(false);
        return;
      }

      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';

      try {
        const response = await fetch(`${apiBase}/auth/me`, {
          headers: {
            Authorization: `Bearer ${storedToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          const validated = normalizeUser(data) ?? storedUser;
          if (mounted) {
            setToken(storedToken);
            setUser(validated);
            localStorage.setItem('roadwatch_user', JSON.stringify(validated));
            localStorage.setItem('roadwatch_role', normalizeRole(validated.role));
          }
        } else if (response.status === 401) {
          const refreshResponse = await fetch(`${apiBase}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
          });

          if (refreshResponse.ok) {
            const payload = await refreshResponse.json();
            const refreshedUser = normalizeUser(payload) ?? storedUser;
            const newToken = payload.token ?? storedToken;
            if (mounted) {
              localStorage.setItem('roadwatch_token', newToken);
              localStorage.setItem('roadwatch_user', JSON.stringify(refreshedUser));
              localStorage.setItem('roadwatch_role', normalizeRole(refreshedUser.role));
              setToken(newToken);
              setUser(refreshedUser);
            }
          } else if (mounted) {
            // Only clear on confirmed auth failure
            localStorage.removeItem('roadwatch_token');
            localStorage.removeItem('roadwatch_user');
            localStorage.removeItem('roadwatch_role');
            setToken(null);
            setUser(null);
          }
        }
        // Other errors (5xx, offline): keep stored session
      } catch {
        // Network error — keep stored session for offline use
        if (mounted) {
          setToken(storedToken);
          setUser(storedUser);
        }
      }

      if (mounted) setLoading(false);
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
        setUser: updateUser,
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
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch user');
      }

      const data = await response.json();
      return normalizeUser(data);
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
