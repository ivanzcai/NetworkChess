const BASE_URL = '/api';

export interface AuthResponse {
  token: string;
  username: string;
  elo: number;
}

export interface UserProfile {
  username: string;
  elo: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  matchHistory: { gameId: string; opponent: string; result: string; date: number }[];
}

export async function register(username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(BASE_URL + '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Registration failed');
  }
  return res.json();
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(BASE_URL + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Login failed');
  }
  return res.json();
}

export async function loginAsGuest(): Promise<AuthResponse> {
  const res = await fetch(BASE_URL + '/auth/guest', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Guest login failed');
  }
  return res.json();
}

export async function getProfile(token: string): Promise<UserProfile> {
  const res = await fetch(BASE_URL + '/auth/profile', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Failed to load profile');
  return res.json();
}

export function getStoredAuth(): AuthResponse | null {
  const stored = localStorage.getItem('chess-auth');
  if (!stored) return null;
  try { return JSON.parse(stored); } catch { return null; }
}

export function storeAuth(auth: AuthResponse): void {
  localStorage.setItem('chess-auth', JSON.stringify(auth));
}

export function clearAuth(): void {
  localStorage.removeItem('chess-auth');
}
