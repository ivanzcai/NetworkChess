import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChessScene } from './components/ChessScene.js';
import { createGame, makeMove, joinGame, subscribeToGame, sendChatMessage, GameResponse, Difficulty } from './api.js';
import {
  requestMagicLink,
  verifyMagicLink,
  startGoogleOAuth,
  devLogin as apiDevLogin,
  exchangeOAuthRedirectToken,
  getStoredAuth,
  storeAuth,
  getProfile,
  clearAuth,
  AuthResponse,
  UserProfile,
} from './auth.js';

type PlayerColor = 'w' | 'b';
type GameMode = 'pve' | 'pvp';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

const PIECE_UNICODE: Record<string, string> = {
  pk: '\u2654', pn: '\u2658', pb: '\u2657', pr: '\u2656', pq: '\u2655', pp: '\u2659',
  nk: '\u265A', nn: '\u265E', nb: '\u265D', nr: '\u265C', nq: '\u265B', np: '\u265F',
  bk: '\u265A', bn: '\u265E', bb: '\u265D', br: '\u265C', bq: '\u265B', bp: '\u265F',
  wk: '\u2654', wn: '\u2658', wb: '\u2657', wr: '\u2656', wq: '\u2655', wp: '\u2659',
};

const PIECE_TYPES = ['q', 'r', 'b', 'n'] as const;

export default function App() {
  const [gameData, setGameData] = useState<GameResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<number | null>(null);
  const [playerColor, setPlayerColor] = useState<PlayerColor>('w');
  const [gameStarted, setGameStarted] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>('pve');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [promotionMove, setPromotionMove] = useState<{ from: number; to: number } | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [auth, setAuth] = useState<AuthResponse | null>(getStoredAuth);
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');

  // Auth & Profile state
  const [profileData, setProfileData] = useState<UserProfile | null>(null);
  // Auth flow is a small state machine: 'choose' (default view) -> 'email'
  // -> 'code' (after magic link sent). Errors stay inline; we don't tear
  // down the modal on transient errors.
  type AuthStep = 'choose' | 'email' | 'code';
  const [authStep, setAuthStep] = useState<AuthStep>('choose');
  const [authEmail, setAuthEmail] = useState('');
  const [authCode, setAuthCode] = useState('');
  // When the server is in "dev mode" (no RESEND_API_KEY) it returns the
  // 6-digit code in /auth/magic-link/request so the user can complete the
  // flow without a working email. We surface it inline in the modal.
  const [authDevCode, setAuthDevCode] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSending, setAuthSending] = useState(false);
  const [authVerifying, setAuthVerifying] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  // /api/auth/config tells us which sign-in buttons to render.
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [devMode, setDevMode] = useState(false);

  // Chat state
  const [chatMessage, setChatMessage] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  const isPlayerTurn = gameData ? gameData.turn === playerColor : false;

  // OAuth callback detection: Google redirects the browser to /oauth/callback
  // ?token=...&returnTo=... after the server resolves the consent flow. We
  // exchange it for an AuthResponse (which validates freshness server-side)
  // and clear the URL fragment so the user lands on the lobby.
  // React 18 StrictMode in dev double-invokes effects; without the ref
  // guard below we'd POST the same T1 to /api/auth/oauth/google/complete
  // twice, the second call returning 401 "Invalid OAuth token" because T1
  // was burned on the first call -- and that error clobbers the success
  // state from the first call.
  const oauthCallbackHandledRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.pathname !== '/oauth/callback') return;
    const token = url.searchParams.get('token');
    const error = url.searchParams.get('error');
    const returnTo = url.searchParams.get('returnTo') || '/';
    if (oauthCallbackHandledRef.current) {
      // We've already exchanged this token during this mount -- just
      // strip the URL so the user doesn't see ?token=... in their bar.
      window.history.replaceState({}, '', returnTo);
      return;
    }
    oauthCallbackHandledRef.current = true;
    if (token) {
      exchangeOAuthRedirectToken(token)
        .then((a) => { setAuth(a); storeAuth(a); })
        .catch((err) => {
          console.error('OAuth exchange failed', err);
          setAuthError(err.message || 'OAuth sign-in failed');
          setAuthModalOpen(true);
        })
        .finally(() => { window.history.replaceState({}, '', returnTo); });
    } else if (error) {
      setAuthError(decodeURIComponent(error));
      setAuthModalOpen(true);
      window.history.replaceState({}, '', '/');
    } else {
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // Fetch server-side auth config on mount so the modal knows whether to
  // show the Google button and the dev-only shortcut.
  useEffect(() => {
    fetch('/api/auth/config')
      .then((r) => r.json())
      .then((cfg: { googleOAuthConfigured: boolean; emailDevMode: boolean }) => {
        setGoogleAvailable(Boolean(cfg.googleOAuthConfigured));
        setDevMode(Boolean(cfg.emailDevMode));
      })
      .catch(() => {});
  }, []);

  // Load profile stats whenever the auth token changes.
  useEffect(() => {
    if (!auth) {
      setProfileData(null);
      return;
    }
    getProfile(auth.token)
      .then((profile) => setProfileData(profile))
      .catch((err) => {
        console.error('Failed to load profile:', err);
        // Likely an expired or revoked token -- clear and force re-auth.
        clearAuth();
        setAuth(null);
        setProfileData(null);
      });
  }, [auth]);

  // Auto scroll chat — only when a new message is actually appended (use length,
  // not the chat array reference, since the server serializes a fresh array on every
  // SSE update). Scroll within the chat container so the page doesn't jump to the
  // bottom on mobile (where chat sits at the bottom of a long stacked layout).
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTo({
        top: chatMessagesRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [gameData?.chat?.length]);

  const handleLogout = useCallback(() => {
    clearAuth();
    setAuth(null);
    setProfileData(null);
  }, []);

  const resetAuthModal = useCallback(() => {
    setAuthStep('choose');
    setAuthEmail('');
    setAuthCode('');
    setAuthDevCode(null);
    setAuthError(null);
  }, []);

  const handleSendMagicCode = useCallback(async (email: string) => {
    setAuthSending(true);
    setAuthError(null);
    setAuthDevCode(null);
    try {
      const r = await requestMagicLink(email);
      setAuthDevCode(r.devCode);
      setAuthEmail(email);
      setAuthStep('code');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setAuthSending(false);
    }
  }, []);

  const handleVerifyMagicCode = useCallback(async (email: string, code: string) => {
    setAuthVerifying(true);
    setAuthError(null);
    try {
      const r = await verifyMagicLink(email, code);
      setAuth(r);
      storeAuth(r);
      setAuthModalOpen(false);
      resetAuthModal();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Invalid or expired code');
    } finally {
      setAuthVerifying(false);
    }
  }, [resetAuthModal]);

  const handleGoogleSignIn = useCallback(async () => {
    setAuthError(null);
    try {
      const r = await startGoogleOAuth('/');
      window.location.href = r.authorizeUrl;
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google sign-in not available');
    }
  }, []);

  const handleDevLogin = useCallback(async (email: string, displayName: string) => {
    setAuthSending(true);
    setAuthError(null);
    try {
      const r = await apiDevLogin(email, displayName);
      setAuth(r);
      storeAuth(r);
      setAuthModalOpen(false);
      resetAuthModal();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Dev sign-in failed');
    } finally {
      setAuthSending(false);
    }
  }, [resetAuthModal]);

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameData || !chatMessage.trim() || !auth) return;
    setChatLoading(true);
    try {
      const updated = await sendChatMessage(gameData.id, auth.displayName, chatMessage.trim());
      setGameData(updated);
      setChatMessage('');
    } catch (err: any) {
      console.error("Failed to send chat message:", err);
    } finally {
      setChatLoading(false);
    }
  };

  const executeMove = useCallback(
    async (from: number, to: number, promotion?: string) => {
      if (!gameData) return;
      setAiThinking(true);
      try {
        const updated = await makeMove(gameData.id, from, to, promotion);
        setGameData(updated);
        setSelectedSquare(null);
        setPromotionMove(null);
        if (updated.status.type === 'active' || updated.status.type === 'check') {
          setAiThinking(updated.turn !== playerColor);
        } else {
          setAiThinking(false);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Move failed');
        setAiThinking(false);
        setSelectedSquare(null);
        setPromotionMove(null);
      }
    },
    [gameData, playerColor]
  );

  const handleSquareClick = useCallback(
    async (square: number) => {
      if (!gameData || !isPlayerTurn || aiThinking) return;
      if (promotionMove) return;

      const pieceOnSquare = getPieceOnSquare(gameData.fen, square);

      if (selectedSquare === null) {
        if (pieceOnSquare && pieceOnSquare[0] === playerColor) {
          const targets = gameData.legalMoves.filter((m) => m.from === square).map((m) => m.to);
          if (targets.length > 0) setSelectedSquare(square);
        }
      } else if (selectedSquare === square) {
        setSelectedSquare(null);
      } else {
        const move = gameData.legalMoves.find((m) => m.from === selectedSquare && m.to === square);
        if (move) {
          if (move.promotion) {
            setPromotionMove({ from: selectedSquare, to: square });
            setSelectedSquare(null);
            return;
          }
          await executeMove(selectedSquare, square);
        } else if (pieceOnSquare && pieceOnSquare[0] === playerColor) {
          const targets = gameData.legalMoves.filter((m) => m.from === square).map((m) => m.to);
          setSelectedSquare(targets.length > 0 ? square : null);
        } else {
          setSelectedSquare(null);
        }
      }
    },
    [gameData, isPlayerTurn, selectedSquare, aiThinking, promotionMove, playerColor, executeMove]
  );

  const startGame = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const game = await createGame(gameMode, playerColor, difficulty);
      setGameData(game);
      setGameStarted(true);
      setSelectedSquare(null);
      setPromotionMove(null);
      setRoomCode(game.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
    } finally {
      setLoading(false);
    }
  }, [playerColor, gameMode, difficulty]);

  const handleJoinGame = useCallback(async () => {
    if (!joinCode.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const game = await joinGame(joinCode.trim());
      setGameData(game);
      setGameStarted(true);
      setSelectedSquare(null);
      setPromotionMove(null);
      setPlayerColor(game.yourColor || 'w');
      setRoomCode(game.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to join game');
    } finally {
      setLoading(false);
    }
  }, [joinCode]);

  useEffect(() => {
    if (!gameData) return;
    const gameId = gameData.id;
    const cleanup = subscribeToGame(
      gameId,
      (updatedGame) => {
        setGameData(updatedGame);
        setAiThinking(false);
      },
      () => { }
    );
    return cleanup;
  }, [gameData?.id]);

  const handlePromotion = useCallback(
    async (promotion: string) => {
      if (!promotionMove) return;
      await executeMove(promotionMove.from, promotionMove.to, promotion);
    },
    [promotionMove, executeMove]
  );

  const newGame = useCallback(() => {
    setGameData(null);
    setGameStarted(false);
    setSelectedSquare(null);
    setPromotionMove(null);
    setError(null);
    setAiThinking(false);
    setRoomCode('');
    setJoinCode('');
  }, []);

  const legalTargets = selectedSquare !== null && gameData
    ? gameData.legalMoves.filter((m) => m.from === selectedSquare).map((m) => ({ to: m.to, promotion: m.promotion }))
    : [];

  const lastMove = gameData?.moveHistory?.length
    ? gameData.moveHistory[gameData.moveHistory.length - 1]
    : null;

  const renderHeader = () => {
    return (
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/logo.png" alt="SkyMate Logo" style={{ width: '40px', height: '40px', borderRadius: '8px', boxShadow: '0 0 8px var(--accent-glow)' }} />
          <h1>SkyMate</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {auth ? (
            <>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {profileData ? `${auth.displayName} (${profileData.elo} ELO)` : auth.displayName}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
                Log Out
              </button>
            </>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { resetAuthModal(); setAuthError(null); setAuthModalOpen(true); }}
            >
              Sign In
            </button>
          )}
        </div>
      </header>
    );
  };

  const closeAuthModal = () => {
    setAuthModalOpen(false);
    // Slight delay so close animation doesn't blank the values first.
    setTimeout(resetAuthModal, 200);
  };

  const renderAuthModal = () => {
    const heading =
      authStep === 'code' ? 'Enter verification code' :
      googleAvailable ? 'Sign in to SkyMate' :
      'Sign in to SkyMate';
    const subtitle =
      authStep === 'code'
        ? `We sent a 6-digit code to ${authEmail}.`
        : 'Use your email for a one-time code, or continue with Google.';

    return (
      <div className="auth-modal-overlay" onClick={closeAuthModal}>
        <div className="auth-modal-content" onClick={(e) => e.stopPropagation()}>
          <button className="auth-modal-close" onClick={closeAuthModal}>&times;</button>
          <h2>{heading}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '-0.5rem', marginBottom: '1rem' }}>
            {subtitle}
          </p>

          {authStep === 'choose' && (
            <>
              {googleAvailable && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary w-full google-signin-btn"
                    onClick={handleGoogleSignIn}
                  >
                    <span className="google-g">G</span> Continue with Google
                  </button>
                  <div className="auth-divider"><span>or</span></div>
                </>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (authEmail.trim()) handleSendMagicCode(authEmail.trim());
                }}
              >
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
                {authError && <p className="auth-error">{authError}</p>}
                <button
                  type="submit"
                  className="btn btn-primary w-full"
                  disabled={authSending || !authEmail.trim()}
                >
                  {authSending ? 'Sending code\u2026' : 'Email me a code'}
                </button>
              </form>

              {devMode && (
                <>
                  <div className="auth-divider"><span>dev shortcut</span></div>
                  <DevLoginForm onSubmit={handleDevLogin} disabled={authSending} />
                </>
              )}
            </>
          )}

          {authStep === 'code' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleVerifyMagicCode(authEmail, authCode);
              }}
            >
              {authDevCode && (
                <div className="dev-code-banner">
                  Dev mode: your code is <code>{authDevCode}</code>
                </div>
              )}
              {!authDevCode && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Check your inbox (and spam folder) for the code.
                </p>
              )}
              <div className="form-group">
                <label>6-digit code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="123456"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoFocus
                />
              </div>
              {authError && <p className="auth-error">{authError}</p>}
              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={authVerifying || authCode.length !== 6}
              >
                {authVerifying ? 'Verifying\u2026' : 'Verify and sign in'}
              </button>
              <button
                type="button"
                className="btn btn-link"
                onClick={() => { setAuthStep('choose'); setAuthError(null); setAuthCode(''); }}
                style={{ marginTop: '0.75rem' }}
              >
                Use a different email
              </button>
            </form>
          )}
        </div>
      </div>
    );
  };

  if (!gameStarted) {
    return (
      <>
        <div className="app">
          {renderHeader()}

          {!auth && (
            <div className="guest-upgrade-banner">
              <span>Sign in to track your ELO rating and view past matches.</span>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { resetAuthModal(); setAuthError(null); setAuthModalOpen(true); }}
              >
                Sign In
              </button>
            </div>
          )}

          {profileData && (
            <div className="profile-stats-card">
              <h3>Your SkyMate Profile</h3>
              <div className="stats-grid">
                <div className="stat-box highlight">
                  <span className="stat-val elo">{profileData.elo}</span>
                  <span className="stat-label">ELO Rating</span>
                </div>
                <div className="stat-box">
                  <span className="stat-val">{profileData.gamesPlayed}</span>
                  <span className="stat-label">Games Played</span>
                </div>
                <div className="stat-box wins">
                  <span className="stat-val">{profileData.wins}</span>
                  <span className="stat-label">Wins</span>
                </div>
                <div className="stat-box losses">
                  <span className="stat-val">{profileData.losses}</span>
                  <span className="stat-label">Losses</span>
                </div>
                <div className="stat-box draws">
                  <span className="stat-val">{profileData.draws}</span>
                  <span className="stat-label">Draws</span>
                </div>
              </div>
              {profileData.matchHistory && profileData.matchHistory.length > 0 && (
                <div className="recent-games">
                  <h4>Past Games</h4>
                  <div className="history-table-container">
                    <table className="history-table">
                      <thead>
                        <tr>
                          <th>Opponent</th>
                          <th>Result</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profileData.matchHistory.slice(0, 5).map((m, idx) => (
                          <tr key={idx}>
                            <td>{m.opponent}</td>
                            <td><span className={`result-tag ${m.result}`}>{m.result.toUpperCase()}</span></td>
                            <td>{new Date(m.date).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="start-screen">
            <h2>Choose Game Mode</h2>
            <div className="btn-group">
              <button className={`btn ${gameMode === 'pve' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setGameMode('pve')}>
                vs Computer
              </button>
              <button className={`btn ${gameMode === 'pvp' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setGameMode('pvp')}>
                vs Player
              </button>
            </div>

            {gameMode === 'pve' && (
              <>
                <h2>Choose Your Color</h2>
                <div className="color-picker">
                  <div className={`color-option ${playerColor === 'w' ? 'selected' : ''}`} onClick={() => setPlayerColor('w')}>
                    <span className="piece-preview">{'\u2654'}</span>
                    <span>Play as White</span>
                  </div>
                  <div className={`color-option ${playerColor === 'b' ? 'selected' : ''}`} onClick={() => setPlayerColor('b')}>
                    <span className="piece-preview">{'\u265A'}</span>
                    <span>Play as Black</span>
                  </div>
                </div>

                <h2>Difficulty</h2>
                <div className="difficulty-picker">
                  {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                    <button
                      key={d}
                      className={`btn ${difficulty === d ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setDifficulty(d)}
                    >
                      {DIFFICULTY_LABELS[d]}
                    </button>
                  ))}
                </div>

                <button className="btn btn-primary btn-lg" onClick={startGame} disabled={loading}>
                  {loading ? 'Starting...' : 'Start Game'}
                </button>
              </>
            )}

            {gameMode === 'pvp' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', width: '100%' }}>
                  <div style={{ width: '100%' }}>
                    <h2>Create a Room</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Choose your color and share the room code with a friend</p>
                    <div className="color-picker" style={{ margin: '1rem 0' }}>
                      <div className={`color-option ${playerColor === 'w' ? 'selected' : ''}`} onClick={() => setPlayerColor('w')}>
                        <span className="piece-preview">{'\u2654'}</span>
                        <span>White</span>
                      </div>
                      <div className={`color-option ${playerColor === 'b' ? 'selected' : ''}`} onClick={() => setPlayerColor('b')}>
                        <span className="piece-preview">{'\u265A'}</span>
                        <span>Black</span>
                      </div>
                    </div>
                    <button className="btn btn-primary" onClick={startGame} disabled={loading}>
                      {loading ? 'Creating...' : 'Create Room'}
                    </button>
                  </div>

                  <div style={{ color: 'var(--text-muted)', fontSize: '1rem', fontWeight: 'bold' }}>— OR —</div>

                  <div style={{ width: '100%' }}>
                    <h2>Join a Room</h2>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <input
                        type="text"
                        placeholder="Room code"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 8))}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleJoinGame(); }}
                      />
                      <button className="btn btn-primary" onClick={handleJoinGame} disabled={loading || !joinCode.trim()}>
                        Join
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {error && <p style={{ color: 'var(--danger)', marginTop: '1rem' }}>{error}</p>}
          </div>
        </div>
        {authModalOpen && renderAuthModal()}
      </>
    );
  }

  return (
    <>
      <div className="app">
        {renderHeader()}
        <div className="game-container">
          <div className="sidebar chat-sidebar">
            <h3>Game Chat</h3>
            <div className="chat-messages" ref={chatMessagesRef}>
              {(gameData?.chat || []).map((msg, i) => {
                const isSelf = msg.sender === auth?.displayName;
                const isSystem = msg.sender === 'SkyMate System';
                const isAi = msg.sender === 'SkyMate AI';
                let bubbleClass = 'chat-bubble-opponent';
                if (isSelf) bubbleClass = 'chat-bubble-self';
                else if (isSystem) bubbleClass = 'chat-bubble-system';
                else if (isAi) bubbleClass = 'chat-bubble-ai';

                return (
                  <div key={i} className={`chat-message ${isSelf ? 'self' : ''} ${isSystem ? 'system' : ''}`}>
                    {!isSystem && <span className="chat-sender">{msg.sender}</span>}
                    <div className={`chat-bubble ${bubbleClass}`}>{msg.text}</div>
                  </div>
                );
              })}
            </div>
            <form className="chat-input-row" onSubmit={handleSendChat}>
              <input
                type="text"
                placeholder="Type a message..."
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                disabled={chatLoading}
              />
              <button type="submit" className="btn btn-primary btn-send" disabled={chatLoading || !chatMessage.trim()}>
                Send
              </button>
            </form>
          </div>

          <div className="board-wrapper">
            <ChessScene
              fen={gameData?.fen || ''}
              selectedSquare={selectedSquare}
              legalTargets={legalTargets}
              lastMove={lastMove}
              playerColor={playerColor}
              onSquareClick={handleSquareClick}
              isFlipped={playerColor === 'b'}
              status={gameData?.status}
              turn={gameData?.turn}
            />
          </div>
          <div className="sidebar right-sidebar">
            <div className="game-info">
              {gameMode === 'pvp' && roomCode && (
                <p style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: '1.1rem' }}>
                  Room: {roomCode}
                </p>
              )}
              <p>
                <span className={`turn-indicator ${gameData?.turn}`} />
                <strong>Turn:</strong> {gameData?.turn === 'w' ? 'White' : 'Black'}
                {aiThinking && gameMode === 'pve' && ' (AI thinking...)'}
              </p>
              <p><strong>You:</strong> {playerColor === 'w' ? 'White' : 'Black'}</p>
              <p><strong>Mode:</strong> {gameMode === 'pve' ? 'vs Computer' : 'vs Player'}{gameData?.difficulty && gameMode === 'pve' ? ` (${DIFFICULTY_LABELS[gameData.difficulty as Difficulty]})` : ''}</p>
              <p><strong>Move:</strong> {gameData?.fullMoveNumber}</p>
              {gameData?.status.type !== 'active' && (
                <span className={`status-badge ${gameData?.status.type}`}>
                  {gameData?.status.type === 'checkmate'
                    ? `Checkmate! ${gameData.status.winner === playerColor ? 'You win!' : gameMode === 'pve' ? 'AI wins!' : 'Opponent wins!'}`
                    : gameData?.status.type === 'stalemate'
                      ? 'Stalemate \u2014 Draw!'
                      : gameData?.status.type === 'draw'
                        ? `Draw \u2014 ${gameData.status.reason}`
                        : 'Check!'}
                </span>
              )}
            </div>

            {gameData && gameData.capturedPieces && (
              <div className="captured-pieces">
                <h3>Captured</h3>
                <div className="captured-label">By you:</div>
                <div className="captured-row">
                  {(gameData.capturedPieces[playerColor === 'w' ? 'w' : 'b'] || []).map((p, i) => (
                    <span key={i}>{getPieceChar(p.type, p.color)}</span>
                  ))}
                </div>
                <div className="captured-label">By opponent:</div>
                <div className="captured-row">
                  {(gameData.capturedPieces[playerColor === 'w' ? 'b' : 'w'] || []).map((p, i) => (
                    <span key={i}>{getPieceChar(p.type, p.color)}</span>
                  ))}
                </div>
              </div>
            )}

            {gameData && gameData.moveHistory && gameData.moveHistory.length > 0 && (
              <>
                <h3>Moves</h3>
                <div className="move-history">
                  <div className="move-list">{renderMoveHistory(gameData.moveHistory)}</div>
                </div>
              </>
            )}



            <div className="btn-group" style={{ marginTop: '1rem' }}>
              <button className="btn btn-secondary" onClick={newGame}>New Game</button>
            </div>

            {error && <p style={{ color: 'var(--danger)', marginTop: '0.5rem' }}>{error}</p>}
          </div>
        </div>

        {promotionMove && (
          <div className="promotion-modal" onClick={() => setPromotionMove(null)}>
            <div className="promotion-choices" onClick={(e) => e.stopPropagation()}>
              {PIECE_TYPES.map((type) => (
                <button key={type} className="promotion-btn" onClick={() => handlePromotion(type)}>
                  {getPieceChar(type, playerColor)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {authModalOpen && renderAuthModal()}
    </>
  );
}

function getPieceOnSquare(fen: string, square: number): string | null {
  const parts = fen.split(' ');
  const ranks = parts[0].split('/');
  const file = square % 8;
  const rank = 7 - Math.floor(square / 8);
  let currentFile = 0;
  const rankStr = ranks[rank];
  for (const char of rankStr) {
    if (char >= '1' && char <= '8') {
      currentFile += parseInt(char);
    } else {
      if (currentFile === file) return char === char.toUpperCase() ? 'w' + char.toLowerCase() : 'b' + char;
      currentFile++;
    }
  }
  return null;
}

function getPieceChar(type: string, color: string): string {
  const key = color + type;
  return PIECE_UNICODE[key] || '?';
}

function renderMoveHistory(moves: { from: number; to: number; san: string }[]) {
  const rows: React.ReactNode[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    rows.push(
      <React.Fragment key={moveNum}>
        <span className="move-number">{moveNum}.</span>
        <span className="move-white">{moves[i]?.san || ''}</span>
        <span className="move-black">{moves[i + 1]?.san || ''}</span>
      </React.Fragment>
    );
  }
  return rows;
}

// Tiny inline form for dev-mode shortcut: POSTs { email, displayName } to
// /api/auth/dev/login so we can test the full flow without a working
// Resend account or Google OAuth app. Server only honors this in non-prod.
function DevLoginForm({ onSubmit, disabled }: { onSubmit: (email: string, displayName: string) => void; disabled: boolean }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim()) onSubmit(email.trim(), displayName.trim() || email.split('@')[0]);
      }}
      style={{ marginTop: '0.5rem' }}
    >
      <div className="form-group" style={{ marginBottom: '0.5rem' }}>
        <input
          type="email"
          placeholder="dev@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="off"
        />
      </div>
      <div className="form-group" style={{ marginBottom: '0.75rem' }}>
        <input
          type="text"
          placeholder="Display name (optional)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoComplete="off"
        />
      </div>
      <button type="submit" className="btn btn-secondary w-full" disabled={disabled || !email.trim()}>
        Dev sign-in
      </button>
    </form>
  );
}
