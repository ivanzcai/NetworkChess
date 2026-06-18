// Google OAuth helpers -- authorization-code flow with PKCE.
// Designed to fail cleanly when GOOGLE_CLIENT_ID/SECRET are unset.

import crypto from 'crypto';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// Where Google will reach the OAuth callback. This MUST be one of the
// "Authorized redirect URIs" listed on the Google Cloud OAuth client.
// In dev with vite on :5173 and express on :3001, this points at 3001
// (the vite proxy only forwards /api/*, so Google must hit express directly).
const OAUTH_REDIRECT_BASE =
  process.env.OAUTH_REDIRECT_BASE || 'http://localhost:3001';
// Where the SPA actually lives and where the browser should land after
// the OAuth callback completes. In dev this is the vite port (5173);
// in prod it equals OAUTH_REDIRECT_BASE (the Cloud Run URL).
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || OAUTH_REDIRECT_BASE;

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

export function getRedirectUri(): string {
  return OAUTH_REDIRECT_BASE.replace(/\/+$/, '') + '/api/auth/oauth/google/callback';
}

export function getPublicBaseUrl(): string {
  return PUBLIC_BASE_URL.replace(/\/+$/, '');
}

// Defense-in-depth: only allow same-origin return paths so a compromised
// /api/auth/oauth/google/start caller can't make us 302 the user to a
// phishing page after sign-in. Browsers also enforce this on
// history.replaceState, but we filter server-side too.
//
// Note: Chrome/Edge normalize "\" → "/" when parsing URLs, so a value like
// "/\evil.com" would parse as "//evil.com" and become protocol-relative.
// We reject any second-char that's "/" or "\" to close that hole.
const SAFE_RETURN_PATH = /^\/[^/\\]/;

export function sanitizeReturnPath(returnTo: string | undefined | null): string {
  if (!returnTo || typeof returnTo !== 'string') return '/';
  if (!SAFE_RETURN_PATH.test(returnTo)) return '/';
  return returnTo;
}

// Pending state store (in-memory, 10-minute TTL).
// LIMITATION: This Map lives inside a single process, so the OAuth flow
// won't work across multiple Cloud Run instances unless sticky-session
// routing is enabled or this moves to a shared store (DB row or signed
// cookie). Single-instance deploys are fine.
interface PendingState {
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
}
const pendingStates: Map<string, PendingState> = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function purgeExpiredStates(): void {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [state, entry] of pendingStates) {
    if (entry.createdAt < cutoff) pendingStates.delete(state);
  }
}

export interface StartedOAuthFlow {
  authorizeUrl: string;
  state: string;
}

export function startGoogleOAuthFlow(returnTo: string = '/'): StartedOAuthFlow {
  if (!isGoogleOAuthConfigured()) {
    throw new Error('Google OAuth is not configured on this server');
  }
  purgeExpiredStates();

  const state = crypto.randomBytes(24).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, getRedirectUri());
  // Use the imported CodeChallengeMethod enum value so TS can match the
  // literal type even when the field's union includes `undefined`.
  const authorizeUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
    prompt: 'select_account',
  });

  pendingStates.set(state, { codeVerifier, returnTo: sanitizeReturnPath(returnTo), createdAt: Date.now() });
  return { authorizeUrl, state };
}

export interface CompletedGoogleOAuth {
  email: string;
  emailVerified: boolean;
  subjectId: string;
  displayName: string;
  returnTo: string;
}

export async function completeGoogleOAuthFlow(
  code: string,
  state: string
): Promise<CompletedGoogleOAuth> {
  if (!isGoogleOAuthConfigured()) {
    throw new Error('Google OAuth is not configured on this server');
  }
  purgeExpiredStates();
  const pending = pendingStates.get(state);
  if (!pending) {
    throw new Error('OAuth state is invalid or has expired');
  }
  pendingStates.delete(state);

  const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, getRedirectUri());
  const { tokens } = await client.getToken({ code, codeVerifier: pending.codeVerifier });
  if (!tokens.id_token) {
    throw new Error('Google did not return an ID token');
  }
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) {
    throw new Error('Google ID token payload missing subject');
  }
  if (!payload.email) {
    throw new Error('Google account has no email; SkyMate requires an email');
  }
  if (payload.email_verified === false) {
    throw new Error('Your Google email is not verified');
  }

  return {
    email: payload.email.toLowerCase().trim(),
    emailVerified: true,
    subjectId: payload.sub,
    displayName:
      (payload.name as string | undefined) ||
      payload.email.split('@')[0] ||
      'Player',
    returnTo: pending.returnTo,
  };
}
