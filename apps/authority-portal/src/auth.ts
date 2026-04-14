const TOKEN_KEY = 'roadwatch.jwt';
const USER_KEY = 'roadwatch.user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function setUser(user: any) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser<T = any>(): T | null {
  const v = localStorage.getItem(USER_KEY);
  return v ? (JSON.parse(v) as T) : null;
}
