const BASE_URL = '/api';

export interface AuthResponse {
  token: string;
  email: string;
  displayName: string;
  elo: number;
}

export interface UserProfile {
  email: string;
  displayName: string;
  elo: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  matchHistory: { gameId: string; opponent: string; result: string; date: number }[];
}

export interface MagicLinkRequestResult {
  // In dev mode (server has no RESEND_API_KEY) the code is returned so the
  // UI can show it inline for testing. In production this is null.
  devCode: string | null;
}

export interface GoogleOAuthStartResult {
  authorizeUrl: string;
}

function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  try {
    const body = err as { error?: string };
    if (body?.error) return new Error(body.error);
  } catch {}
  return new Error('Network error');
}

// ── Passwordless magic link ──

export async function requestMagicLink(email: string): Promise<MagicLinkRequestResult> {
  const res = await fetch(BASE_URL + '/auth/magic-link/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to send code');
  }
  return res.json();
}

export async function verifyMagicLink(email: string, code: string): Promise<AuthResponse> {
  const res = await fetch(BASE_URL + '/auth/magic-link/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), code: code.trim() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw asError(err);
  }
  return res.json();
}

// ── Google OAuth ──
// The server returns the Google consent URL. We open the browser to it;
// Google redirects back to /api/auth/oauth/google/callback which 302s to
// /oauth/callback?token=… on the same origin (the SPA catches that path).
export async function startGoogleOAuth(returnTo: string = '/'): Promise<GoogleOAuthStartResult> {
  const res = await fetch(BASE_URL + '/auth/oauth/google/start?returnTo=' + encodeURIComponent(returnTo), {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to start Google sign-in');
  }
  return res.json();
}

// Called when the SPA detects it has been redirected back from Google with a
// fresh token in the URL. Returns the parsed AuthResponse on success.
export async function exchangeOAuthRedirectToken(token: string): Promise<AuthResponse> {
  const res = await fetch(BASE_URL + '/auth/oauth/google/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'OAuth sign-in failed');
  }
  return res.json();
}

// ── Dev-only sign in (NON-production only; the server disables it in prod) ──
export async function devLogin(email: string, displayName: string): Promise<AuthResponse> {
  const res = await fetch(BASE_URL + '/auth/dev/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), displayName: displayName.trim() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Dev login failed');
  }
  return res.json();
}

// ── Profile ──

export async function getProfile(token: string): Promise<UserProfile> {
  const res = await fetch(BASE_URL + '/auth/profile', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Failed to load profile');
  return res.json();
}

// ── Local storage helpers ──

const STORAGE_KEY = 'chess-auth';

export function getStoredAuth(): AuthResponse | null {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (!stored) return null;
  try { return JSON.parse(stored); } catch { return null; }
}

export function storeAuth(auth: AuthResponse): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  }
}

export function clearAuth(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}
