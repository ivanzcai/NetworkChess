import React, { useState, useEffect, useCallback } from 'react';
import { ChessBoard } from './ChessBoard.js';
import { ChessBoard3D } from './ChessBoard3D.js';
import { createGame, makeMove, joinGame, subscribeToGame, GameResponse, Difficulty } from './api.js';
import { loginAsGuest, getStoredAuth, storeAuth, AuthResponse } from './auth.js';

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
  const [viewMode, setViewMode] = useState<'2d' | '3d'>(() => {
    const saved = localStorage.getItem('chess-viewmode');
    return saved === '3d' ? '3d' : '2d';
  });

  useEffect(() => {
    localStorage.setItem('chess-viewmode', viewMode);
  }, [viewMode]);

  const isPlayerTurn = gameData ? gameData.turn === playerColor : false;

  // Auto guest login on startup
  useEffect(() => {
    if (!auth) {
      loginAsGuest().then((a) => { setAuth(a); storeAuth(a); }).catch(() => {});
    }
  }, []);

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
      () => {}
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

  if (!gameStarted) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>NetworkChess</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {auth && <span style={{ color: '#888', fontSize: '0.85rem' }}>Playing as {auth.username}</span>}
            <button className="btn btn-secondary" onClick={() => setViewMode(viewMode === '2d' ? '3d' : '2d')} style={{ padding: '0.4rem 0.8rem', fontSize: '0.82rem' }}>
              {viewMode === '2d' ? '🌐 Play in 3D' : '📄 Play in 2D'}
            </button>
          </div>
        </header>
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

              <button className="btn btn-primary" onClick={startGame} disabled={loading}>
                {loading ? 'Starting...' : 'Start Game'}
              </button>
            </>
          )}

          {gameMode === 'pvp' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
                <div>
                  <h2>Create a Room</h2>
                  <p style={{ color: '#888', marginTop: '0.5rem' }}>Choose your color and share the room code with a friend</p>
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

                <div style={{ color: '#555', fontSize: '1.2rem' }}>— OR —</div>

                <div>
                  <h2>Join a Room</h2>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <input
                      type="text"
                      placeholder="Room code"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 8))}
                      style={{
                        padding: '0.6rem 1rem',
                        borderRadius: '6px',
                        border: '1px solid #2a2a4a',
                        background: '#0d1b3e',
                        color: '#e0e0e0',
                        fontSize: '1rem',
                        textTransform: 'uppercase',
                        letterSpacing: '2px',
                        width: '160px',
                        textAlign: 'center',
                      }}
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

          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>NetworkChess</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {auth && <span style={{ color: '#888', fontSize: '0.85rem' }}>{auth.username}</span>}
          <button className="btn btn-secondary" onClick={() => setViewMode(viewMode === '2d' ? '3d' : '2d')} style={{ padding: '0.4rem 0.8rem', fontSize: '0.82rem' }}>
            {viewMode === '2d' ? '🌐 Play in 3D' : '📄 Play in 2D'}
          </button>
        </div>
      </header>
      <div className="game-container">
        <div className="board-wrapper">
          {viewMode === '3d' ? (
            <ChessBoard3D
              fen={gameData?.fen || ''}
              selectedSquare={selectedSquare}
              legalTargets={legalTargets}
              lastMove={lastMove}
              playerColor={playerColor}
              onSquareClick={handleSquareClick}
              isFlipped={playerColor === 'b'}
            />
          ) : (
            <ChessBoard
              fen={gameData?.fen || ''}
              selectedSquare={selectedSquare}
              legalTargets={legalTargets}
              lastMove={lastMove}
              playerColor={playerColor}
              onSquareClick={handleSquareClick}
              isFlipped={playerColor === 'b'}
            />
          )}
        </div>
        <div className="sidebar">
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

          <div className="btn-group">
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
