import type { Role } from '../contexts/AuthContext';

export function getDashboardPath(role?: Role | string | null): string {
  const r = String(role ?? 'CITIZEN').toUpperCase();
  if (r === 'CE' || r === 'EE') return '/dashboard/authority';
  if (r === 'CONTRACTOR') return '/dashboard/contractor';
  if (r === 'SUPER_ADMIN') return '/dashboard/super-admin';
  return '/dashboard/citizen';
}

export function getLoginPathForRole(role?: Role | string | null): string {
  const r = String(role ?? 'CITIZEN').toUpperCase();
  if (r === 'CONTRACTOR') return '/auth/contractor/login';
  if (r === 'CE' || r === 'EE') return '/auth/authority/login';
  return '/auth/citizen/login';
}

/** Safe internal redirect target after login */
export function sanitizeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  let decoded = next;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return null;
  if (decoded.startsWith('/auth/') || decoded === '/login') return null;
  return decoded;
}

export function resolvePostLoginPath(role: Role, next: string | null | undefined): string {
  return sanitizeNextPath(next) ?? getDashboardPath(role);
}

export function isOfflineToken(token: string | null | undefined): boolean {
  return !!token && (token.startsWith('dummy-') || token.includes('dummy'));
}

export function parseStoredUser(raw: string | null): import('../contexts/AuthContext').AuthUser | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
