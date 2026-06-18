import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import {
  createInitialGameState,
  makeMove,
  getLegalMoves,
  isMoveLegal,
  moveToSan,
  toFen,
  getGameStatus,
  Color,
  PieceType,
  GameState,
  Move,
  GameStatus,
} from '@network-chess/core';
import { getBestMove, Difficulty } from '@network-chess/engine';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import crypto from 'crypto';

import {
  sendMagicCodeEmail,
  generateSixDigitCode,
  hashMagicCode,
  isEmailDevMode,
} from './email.js';
import {
  isGoogleOAuthConfigured,
  startGoogleOAuthFlow,
  completeGoogleOAuthFlow,
  getPublicBaseUrl,
} from './oauthGoogle.js';

const app = express();
const PORT = process.env.PORT || 3001;
// Disable dangerous dev fallbacks in production.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/chess?schema=public';
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

app.use(cors());
app.use(express.json());

// Make this reachable from the client so the UI can decide whether to show
// the Google button at all (vs. just disabling it on click).
app.get('/api/auth/config', (_req, res) => {
  res.json({
    googleOAuthConfigured: isGoogleOAuthConfigured(),
    emailDevMode: isEmailDevMode(),
  });
});

// ── Game Connection Storage (in-memory) ──
const activeSseClients: Map<string, Set<(data: string) => void>> = new Map();

function serializeGameFromDb(game: any): Record<string, unknown> {
  const state = JSON.parse(game.stateJson) as GameState;
  const status = JSON.parse(game.statusJson) as GameStatus;

  // Reconstruct game states sequentially to generate correct SAN notation
  let tempState = createInitialGameState();
  const moveHistoryWithSan = state.moveHistory.map((m) => {
    const san = moveToSan(tempState, m);
    const result = makeMove(tempState, m);
    tempState = result.newState;
    return {
      from: m.from,
      to: m.to,
      promotion: m.promotion || null,
      san,
    };
  });

  return {
    id: game.id,
    fen: toFen(
      state.board,
      state.turn,
      state.castlingRights,
      state.enPassantSquare,
      state.halfMoveClock,
      state.fullMoveNumber
    ),
    turn: state.turn,
    status: status,
    legalMoves: getLegalMoves(state).map((m) => ({
      from: m.from,
      to: m.to,
      promotion: m.promotion || null,
    })),
    moveHistory: moveHistoryWithSan,
    capturedPieces: {
      w: state.capturedPieces[Color.White].map((p) => ({ type: p.type, color: p.color })),
      b: state.capturedPieces[Color.Black].map((p) => ({ type: p.type, color: p.color })),
    },
    gameType: game.gameType,
    playerColor: game.playerColor,
    difficulty: game.difficulty,
    fullMoveNumber: state.fullMoveNumber,
    chat: JSON.parse(game.chatJson || '[]'),
    whiteUsername: game.whiteUsername || null,
    blackUsername: game.blackUsername || null,
  };
}

function broadcastGame(gameId: string, serializedGameData: Record<string, unknown>): void {
  const clients = activeSseClients.get(gameId);
  if (!clients) return;
  const data = JSON.stringify(serializedGameData);
  for (const send of clients) {
    try {
      send(data);
    } catch {
      // Client disconnected
    }
  }
}

interface Identity {
  userId: string;
  email: string;
  displayName: string;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

async function getUserFromToken(req: express.Request): Promise<Identity | null> {
  const tokenVal = req.headers.authorization?.replace('Bearer ', '');
  if (!tokenVal) return null;
  const tokenObj = await prisma.token.findUnique({
    where: { token: tokenVal },
    include: { user: true },
  });
  if (!tokenObj || !tokenObj.user) return null;
  return {
    userId: tokenObj.user.id,
    email: tokenObj.user.email,
    displayName: tokenObj.user.displayName,
  };
}

function deriveDisplayNameFromEmail(email: string): string {
  const at = email.indexOf('@');
  return (at > 0 ? email.slice(0, at) : email) || 'Player';
}

async function findOrCreateUserByEmail(emailRaw: string): Promise<{ userId: string; displayName: string }> {
  const email = emailRaw.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { userId: existing.id, displayName: existing.displayName };
  const user = await prisma.user.create({
    data: {
      email,
      displayName: deriveDisplayNameFromEmail(email),
      elo: 1200,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    },
  });
  return { userId: user.id, displayName: user.displayName };
}

async function createGame(
  gameType: 'pve' | 'pvp',
  playerColor: Color = Color.White,
  difficulty: Difficulty = 'medium',
  creator: Identity | null = null
) {
  const id = uuidv4().slice(0, 8);
  const state = createInitialGameState();
  const initialFen = toFen(
    state.board,
    state.turn,
    state.castlingRights,
    state.enPassantSquare,
    state.halfMoveClock,
    state.fullMoveNumber
  );

  const status: GameStatus = { type: 'active' };
  const positionHistory = [initialFen];

  // For PvE, the AI takes the opposite seat. For PvP, only the creator's seat
  // is filled until someone joins.
  let whiteUsername: string | null = null;
  let blackUsername: string | null = null;
  let whiteUserId: string | null = null;
  let blackUserId: string | null = null;
  if (gameType === 'pve') {
    if (playerColor === Color.White) {
      whiteUsername = creator?.displayName ?? null;
      whiteUserId = creator?.userId ?? null;
      blackUsername = 'Computer';
      blackUserId = null;
    } else {
      whiteUsername = 'Computer';
      whiteUserId = null;
      blackUsername = creator?.displayName ?? null;
      blackUserId = creator?.userId ?? null;
    }
  } else if (creator) {
    if (playerColor === Color.White) {
      whiteUsername = creator.displayName;
      whiteUserId = creator.userId;
    } else {
      blackUsername = creator.displayName;
      blackUserId = creator.userId;
    }
  }

  const initialChat = gameType === 'pve' ? [
    {
      sender: 'SkyMate AI',
      text: "Good luck! Let's have a great game.",
      timestamp: Date.now(),
    }
  ] : [];

  const game = await prisma.game.create({
    data: {
      id,
      stateJson: JSON.stringify(state),
      statusJson: JSON.stringify(status),
      positionHistory: JSON.stringify(positionHistory),
      gameType,
      playerColor,
      aiColor: playerColor === Color.White ? Color.Black : Color.White,
      difficulty,
      playerCount: 1,
      whiteUsername,
      blackUsername,
      whiteUserId,
      blackUserId,
      chatJson: JSON.stringify(initialChat),
    },
  });

  return game;
}

function applyMoveToGameState(
  state: GameState,
  positionHistory: string[],
  move: Move
): { newState: GameState; newHistory: string[]; fen: string; status: GameStatus } {
  const { newState } = makeMove(state, move);
  const fen = toFen(
    newState.board,
    newState.turn,
    newState.castlingRights,
    newState.enPassantSquare,
    newState.halfMoveClock,
    newState.fullMoveNumber
  );
  const newHistory = [...positionHistory, fen];

  // Compute status with full position history for threefold detection
  const status = getGameStatus(
    newState.board,
    newState.turn,
    newState.kingsPosition[newState.turn],
    newState.castlingRights,
    newState.enPassantSquare,
    newState.halfMoveClock,
    newHistory
  );
  return { newState, newHistory, fen, status };
}

// Cleanup stale games every 10 minutes
setInterval(async () => {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const staleGames = await prisma.game.findMany({
      where: {
        createdAt: { lt: oneHourAgo },
      },
      select: { id: true },
    });

    if (staleGames.length > 0) {
      const ids = staleGames.map((g) => g.id);
      await prisma.game.deleteMany({ where: { id: { in: ids } } });
      for (const id of ids) activeSseClients.delete(id);
    }
  } catch (error) {
    console.error('Failed to cleanup stale games:', error);
  }
}, 10 * 60 * 1000);

// ── REST Endpoints (games) ──

// Create a new game (PvE or PvP)
app.post('/api/games', async (req, res) => {
  try {
    const { gameType = 'pve', playerColor = 'w', difficulty = 'medium' } = req.body;
    const color = playerColor === 'b' ? Color.Black : Color.White;

    const identity = await getUserFromToken(req);
    const game = await createGame(gameType, color, difficulty as Difficulty, identity);

    let state = JSON.parse(game.stateJson) as GameState;

    // If player chose black in PvE, AI makes first move
    if (game.gameType === 'pve' && color === Color.Black) {
      const aiMove = getBestMove(state, { difficulty: game.difficulty as Difficulty });
      if (aiMove) {
        const positionHistory = JSON.parse(game.positionHistory) as string[];
        const { newState, newHistory, status: newStatus } = applyMoveToGameState(
          state,
          positionHistory,
          aiMove
        );

        const updatedGame = await prisma.game.update({
          where: { id: game.id },
          data: {
            stateJson: JSON.stringify(newState),
            statusJson: JSON.stringify(newStatus),
            positionHistory: JSON.stringify(newHistory),
          },
        });
        return res.json(serializeGameFromDb(updatedGame));
      }
    }

    res.json(serializeGameFromDb(game));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Join a PvP game by room code
app.post('/api/games/:id/join', async (req, res) => {
  try {
    const game = await prisma.game.findUnique({
      where: { id: req.params.id.toLowerCase() },
    });
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.gameType !== 'pvp') return res.status(400).json({ error: 'Not a PvP game' });
    if (game.playerCount && game.playerCount >= 2) {
      return res.status(400).json({ error: 'Game is full' });
    }

    const identity = await getUserFromToken(req);
    if (!identity) return res.status(401).json({ error: 'Sign in to join a PvP game' });

    const joinerColor = game.playerColor === Color.White ? Color.Black : Color.White;

    const dataToUpdate: any = { playerCount: 2 };
    if (joinerColor === Color.White) {
      dataToUpdate.whiteUsername = identity.displayName;
      dataToUpdate.whiteUserId = identity.userId;
    } else {
      dataToUpdate.blackUsername = identity.displayName;
      dataToUpdate.blackUserId = identity.userId;
    }

    const updatedGame = await prisma.game.update({
      where: { id: game.id },
      data: dataToUpdate,
    });

    res.json({ ...serializeGameFromDb(updatedGame), yourColor: joinerColor });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get game state
app.get('/api/games/:id', async (req, res) => {
  try {
    const game = await prisma.game.findUnique({
      where: { id: req.params.id.toLowerCase() },
    });
    if (!game) return res.status(404).json({ error: 'Game not found' });
    res.json(serializeGameFromDb(game));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function checkAndResolveGame(gameId: string) {
  try {
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) return;

    const status = JSON.parse(game.statusJson) as GameStatus;
    if (status.type === 'active' || status.type === 'check') return;

    const alreadyResolved = await prisma.matchHistory.findFirst({ where: { gameId } });
    if (alreadyResolved) return;

    // Identity: prefer the userId FK + look up the current User row so renames
    // are reflected in ELO/MatchHistory; fall back to the username snapshot
    // (kept so the AI ELO and message text still have something to show).
    const whiteId = game.whiteUserId;
    const blackId = game.blackUserId;
    const whiteNameSnap = game.whiteUsername;
    const blackNameSnap = game.blackUsername;

    const whiteUser = whiteId ? await prisma.user.findUnique({ where: { id: whiteId } }) : null;
    const blackUser = blackId ? await prisma.user.findUnique({ where: { id: blackId } }) : null;

    const getAiElo = (diff: string) => {
      if (diff === 'easy') return 800;
      if (diff === 'hard') return 1600;
      return 1200;
    };

    const rWhite = whiteUser
      ? whiteUser.elo
      : whiteNameSnap === 'Computer' ? getAiElo(game.difficulty) : 1000;
    const rBlack = blackUser
      ? blackUser.elo
      : blackNameSnap === 'Computer' ? getAiElo(game.difficulty) : 1000;

    let outcome = 0.5;
    if (status.type === 'checkmate') {
      outcome = status.winner === 'w' ? 1.0 : 0.0;
    }

    const eWhite = 1 / (1 + Math.pow(10, (rBlack - rWhite) / 400));
    const eBlack = 1 / (1 + Math.pow(10, (rWhite - rBlack) / 400));

    const deltaWhite = Math.round(32 * (outcome - eWhite));
    const deltaBlack = Math.round(32 * (1 - outcome - eBlack));

    // Use the SNAPSHOT (whiteUsername/blackUsername) consistently for BOTH
    // the chat winner line and the ELO message. This way if the player
    // renames mid-history, the chat still reads accurately.
    const whiteDisplayName = whiteNameSnap ?? 'White';
    const blackDisplayName = blackNameSnap ?? 'Black';

    let systemMessage = '';
    if (status.type === 'checkmate') {
      const winnerName =
        status.winner === 'w' ? whiteDisplayName : blackDisplayName;
      systemMessage = `Game Over: ${winnerName} wins by checkmate!`;
    } else if (status.type === 'stalemate') {
      systemMessage = 'Game Over: Draw by stalemate.';
    } else {
      systemMessage = `Game Over: Draw (${status.reason || 'agreement'}).`;
    }

    if (whiteUser && whiteId) {
      const wResult = outcome === 1 ? 'win' : outcome === 0 ? 'loss' : 'draw';
      await prisma.user.update({
        where: { id: whiteId },
        data: {
          elo: { increment: deltaWhite },
          gamesPlayed: { increment: 1 },
          wins: { increment: outcome === 1 ? 1 : 0 },
          losses: { increment: outcome === 0 ? 1 : 0 },
          draws: { increment: outcome === 0.5 ? 1 : 0 },
        },
      });
      await prisma.matchHistory.create({
        data: {
          userId: whiteId,
          gameId,
          opponent: blackDisplayName,
          result: wResult,
        },
      });
      systemMessage += ` ${whiteDisplayName} ELO: ${rWhite} -> ${rWhite + deltaWhite} (${deltaWhite >= 0 ? '+' : ''}${deltaWhite}).`;
    }

    if (blackUser && blackId) {
      const bResult = outcome === 0 ? 'win' : outcome === 1 ? 'loss' : 'draw';
      await prisma.user.update({
        where: { id: blackId },
        data: {
          elo: { increment: deltaBlack },
          gamesPlayed: { increment: 1 },
          wins: { increment: outcome === 0 ? 1 : 0 },
          losses: { increment: outcome === 1 ? 1 : 0 },
          draws: { increment: outcome === 0.5 ? 1 : 0 },
        },
      });
      await prisma.matchHistory.create({
        data: {
          userId: blackId,
          gameId,
          opponent: whiteDisplayName,
          result: bResult,
        },
      });
      systemMessage += ` ${blackDisplayName} ELO: ${rBlack} -> ${rBlack + deltaBlack} (${deltaBlack >= 0 ? '+' : ''}${deltaBlack}).`;
    }

    const chat = JSON.parse(game.chatJson || '[]');
    chat.push({
      sender: 'SkyMate System',
      text: systemMessage,
      timestamp: Date.now(),
    });

    if (game.gameType === 'pve') {
      let aiComment = '';
      const userIsWhite = game.playerColor === 'w';
      const userWon = (userIsWhite && outcome === 1) || (!userIsWhite && outcome === 0);

      if (status.type === 'checkmate') {
        aiComment = userWon
          ? 'Congratulations! You played a brilliant game.'
          : 'Good game! Better luck next time.';
      } else {
        aiComment = 'A very close match! Well played.';
      }
      chat.push({
        sender: 'SkyMate AI',
        text: aiComment,
        timestamp: Date.now() + 50,
      });
    }

    const finalGame = await prisma.game.update({
      where: { id: gameId },
      data: { chatJson: JSON.stringify(chat) },
    });

    broadcastGame(gameId, serializeGameFromDb(finalGame));
  } catch (error) {
    console.error('Failed to resolve game outcomes:', error);
  }
}

// Make a move
app.post('/api/games/:id/move', async (req, res) => {
  try {
    const game = await prisma.game.findUnique({
      where: { id: req.params.id.toLowerCase() },
    });
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const state = JSON.parse(game.stateJson) as GameState;
    const status = JSON.parse(game.statusJson) as GameStatus;
    const positionHistory = JSON.parse(game.positionHistory) as string[];

    if (status.type !== 'active' && status.type !== 'check') {
      return res.status(400).json({ error: 'Game is over', status });
    }

    const { from, to, promotion } = req.body;
    const move: Move = { from, to, promotion };

    if (!isMoveLegal(state, move)) {
      return res.status(400).json({ error: 'Illegal move' });
    }

    const { newState, newHistory, status: newStatus } = applyMoveToGameState(
      state,
      positionHistory,
      move
    );

    const updatedGame = await prisma.game.update({
      where: { id: game.id },
      data: {
        stateJson: JSON.stringify(newState),
        statusJson: JSON.stringify(newStatus),
        positionHistory: JSON.stringify(newHistory),
      },
    });

    const serialized = serializeGameFromDb(updatedGame);
    broadcastGame(game.id, serialized);

    if (newStatus.type !== 'active' && newStatus.type !== 'check') {
      checkAndResolveGame(game.id);
    }

    // AI response for PvE
    if (
      game.gameType === 'pve' &&
      newState.turn === game.aiColor &&
      (newStatus.type === 'active' || newStatus.type === 'check')
    ) {
      setTimeout(async () => {
        try {
          const latestGame = await prisma.game.findUnique({ where: { id: game.id } });
          if (!latestGame) return;

          const latestState = JSON.parse(latestGame.stateJson) as GameState;
          const latestHistory = JSON.parse(latestGame.positionHistory) as string[];

          const aiMove = getBestMove(latestState, {
            difficulty: latestGame.difficulty as Difficulty,
          });
          if (aiMove) {
            const {
              newState: aiState,
              newHistory: aiHistory,
              status: aiStatus,
            } = applyMoveToGameState(latestState, latestHistory, aiMove);

            const aiUpdatedGame = await prisma.game.update({
              where: { id: game.id },
              data: {
                stateJson: JSON.stringify(aiState),
                statusJson: JSON.stringify(aiStatus),
                positionHistory: JSON.stringify(aiHistory),
              },
            });

            if (aiStatus.type !== 'active' && aiStatus.type !== 'check') {
              checkAndResolveGame(game.id);
            } else {
              const chat = JSON.parse(aiUpdatedGame.chatJson || '[]');
              let aiText = '';
              if (aiStatus.type === 'check') {
                aiText = 'Check! Keep your King safe.';
              } else if (Math.random() < 0.15) {
                const comments = [
                  "Hmm, let's see how you handle this.",
                  'Your turn! Make it count.',
                  'Interesting move. Here is my reply.',
                  "Nice play! Let's keep it going.",
                  'I see your plan...',
                  "Let's see what happens next.",
                ];
                aiText = comments[Math.floor(Math.random() * comments.length)];
              }

              let finalAiUpdatedGame = aiUpdatedGame;
              if (aiText) {
                chat.push({ sender: 'SkyMate AI', text: aiText, timestamp: Date.now() });
                finalAiUpdatedGame = await prisma.game.update({
                  where: { id: game.id },
                  data: { chatJson: JSON.stringify(chat) },
                });
              }

              const aiSerialized = serializeGameFromDb(finalAiUpdatedGame);
              broadcastGame(game.id, aiSerialized);
            }
          }
        } catch (err) {
          console.error('Error in AI move execution:', err);
        }
      }, 300);
    }

    res.json(serialized);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get legal moves for a square
app.get('/api/games/:id/moves/:square', async (req, res) => {
  try {
    const game = await prisma.game.findUnique({
      where: { id: req.params.id.toLowerCase() },
    });
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const state = JSON.parse(game.stateJson) as GameState;
    const square = parseInt(req.params.square);
    const legalMoves = getLegalMoves(state).filter((m) => m.from === square);
    res.json(legalMoves.map((m) => ({ to: m.to, promotion: m.promotion || null })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List all games (for demo purposes)
app.get('/api/games', async (_req, res) => {
  try {
    const gamesList = await prisma.game.findMany();
    res.json(gamesList.map(serializeGameFromDb));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── SSE Endpoint ──
app.get('/api/games/:id/stream', async (req, res) => {
  try {
    const game = await prisma.game.findUnique({
      where: { id: req.params.id.toLowerCase() },
    });
    if (!game) return res.status(404).json({ error: 'Game not found' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    res.write('data: ' + JSON.stringify(serializeGameFromDb(game)) + '\n\n');

    let clients = activeSseClients.get(game.id);
    if (!clients) {
      clients = new Set();
      activeSseClients.set(game.id, clients);
    }

    const send = (data: string) => {
      res.write('data: ' + data + '\n\n');
    };

    clients.add(send);

    req.on('close', () => {
      clients?.delete(send);
      if (clients?.size === 0) activeSseClients.delete(game.id);
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send a chat message. `sender` is the user's displayName; we derive it from
// the bearer token and ignore the body value so a compromised client can't
// impersonate another player.
app.post('/api/games/:id/chat', async (req, res) => {
  try {
    const game = await prisma.game.findUnique({
      where: { id: req.params.id.toLowerCase() },
    });
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const identity = await getUserFromToken(req);
    if (!identity) return res.status(401).json({ error: 'Sign in to chat' });

    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const chat = JSON.parse(game.chatJson || '[]');
    chat.push({
      sender: identity.displayName,
      text: text.trim().slice(0, 500),
      timestamp: Date.now(),
    });

    const updatedGame = await prisma.game.update({
      where: { id: game.id },
      data: { chatJson: JSON.stringify(chat) },
    });

    const serialized = serializeGameFromDb(updatedGame);
    broadcastGame(game.id, serialized);

    res.json(serialized);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Health Check ──
app.get('/api/health', async (_req, res) => {
  try {
    const count = await prisma.game.count();
    res.json({ status: 'ok', games: count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', details: (error as Error).message });
  }
});

// ── Auth (email-first: passwordless magic link + Google OAuth + dev fallback) ──

const MAGIC_CODE_TTL_MS = 10 * 60 * 1000;
const MAGIC_CODE_COOLDOWN_MS = 60 * 1000;

// Request a 6-digit code to be sent to `email`. Returns the code inline in
// dev mode (when RESEND_API_KEY is unset) so the UI can display it for
// local testing -- production NEVER exposes the code in the response.
app.post('/api/auth/magic-link/request', async (req, res) => {
  try {
    const { email } = req.body;
    const trimmed = (email || '').toLowerCase().trim();
    if (!/.+@.+\..+/.test(trimmed)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Cooldown: avoid spamming users (and being billed by Resend).
    const recent = await prisma.magicCode.findFirst({
      where: { email: trimmed },
      orderBy: { createdAt: 'desc' },
    });
    if (recent && Date.now() - recent.createdAt.getTime() < MAGIC_CODE_COOLDOWN_MS) {
      const wait = Math.ceil(
        (MAGIC_CODE_COOLDOWN_MS - (Date.now() - recent.createdAt.getTime())) / 1000
      );
      return res
        .status(429)
        .json({ error: `Please wait ${wait}s before requesting another code` });
    }

    // Invalidate any unconsumed codes for this email.
    await prisma.magicCode.updateMany({
      where: { email: trimmed, consumed: false },
      data: { consumed: true, consumedAt: new Date() },
    });

    const code = generateSixDigitCode();
    const codeHash = hashMagicCode(code, trimmed);
    await prisma.magicCode.create({
      data: {
        email: trimmed,
        codeHash,
        expiresAt: new Date(Date.now() + MAGIC_CODE_TTL_MS),
      },
    });

    const sendResult = await sendMagicCodeEmail(trimmed, code);
    if (!sendResult.success) {
      return res.status(502).json({ error: sendResult.error || 'Could not send email' });
    }

    res.json({
      devCode: isEmailDevMode() ? sendResult.devCode ?? null : null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify a code and mint a User (if needed) + Token.
app.post('/api/auth/magic-link/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    const trimmedEmail = (email || '').toLowerCase().trim();
    if (!trimmedEmail || !code || code.length !== 6) {
      return res.status(400).json({ error: 'Email and 6-digit code are required' });
    }

    const codeHash = hashMagicCode(code, trimmedEmail);
    const row = await prisma.magicCode.findFirst({
      where: {
        email: trimmedEmail,
        codeHash,
        consumed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!row) return res.status(401).json({ error: 'Invalid or expired code' });

    // Mark consumed (single-use).
    await prisma.magicCode.update({
      where: { id: row.id },
      data: { consumed: true, consumedAt: new Date() },
    });

    const { userId, displayName } = await findOrCreateUserByEmail(trimmedEmail);
    const token = generateToken();
    await prisma.token.create({
      data: { token, userId, method: 'magic-link' },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    res.json({ token, email: trimmedEmail, displayName, elo: user?.elo ?? 1200 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dev shortcut: when NODE_ENV !== "production", sign in as any
// email/displayName combo without sending a code or going through Google.
// Disabled in production -- the endpoint returns 404.
app.post('/api/auth/dev/login', async (req, res) => {
  if (IS_PRODUCTION) return res.status(404).json({ error: 'Not found' });
  try {
    const { email, displayName } = req.body;
    if (!email || !/.+@.+\..+/.test(email.toLowerCase().trim())) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    const trimmedEmail = email.toLowerCase().trim();
    const { userId } = await findOrCreateUserByEmail(trimmedEmail);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    let nextDisplay = displayName?.trim() || user?.displayName;
    if (displayName && displayName.trim() && displayName.trim() !== user?.displayName) {
      await prisma.user.update({
        where: { id: userId },
        data: { displayName: displayName.trim() },
      });
      nextDisplay = displayName.trim();
    }
    const token = generateToken();
    await prisma.token.create({ data: { token, userId, method: 'dev' } });
    res.json({
      token,
      email: trimmedEmail,
      displayName: nextDisplay || 'Player',
      elo: user?.elo ?? 1200,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Begin a Google OAuth flow. Server returns the consent-screen URL; client
// redirects the browser to it.
app.post('/api/auth/oauth/google/start', async (req, res) => {
  try {
    if (!isGoogleOAuthConfigured()) {
      return res
        .status(503)
        .json({ error: 'Google sign-in is not configured on this server' });
    }
    const returnTo = (req.query.returnTo as string) || '/';
    const { authorizeUrl } = startGoogleOAuthFlow(returnTo);
    res.json({ authorizeUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Google redirects the user's browser here with ?code= && ?state=.
// On success we 302 to /oauth/callback?token=<fresh token> on the SAME host so
// the SPA can catch it and exchange it for an AuthResponse via
// /api/auth/oauth/google/complete (kept as a separate endpoint so the
// redirect can fail with a clean JSON error if something goes wrong).
app.get('/api/auth/oauth/google/callback', async (req, res) => {
  try {
    if (!isGoogleOAuthConfigured()) {
      return res.status(503).send('Google sign-in not configured');
    }
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    if (!code || !state) return res.status(400).send('Missing code/state');

    const completed = await completeGoogleOAuthFlow(code, state);

    // Find-or-create the User row. If the email already exists we LINK the
    // OAuth subject to it; otherwise we create a fresh User. Only the id
    // is used here -- the SPA fetches canonical email/displayName/elo via
    // /api/auth/oauth/google/complete so they don't ride along in the
    // redirect URL (no leak into browser history or Referer).
    const { userId } = await findOrCreateUserByEmail(completed.email);
    // Refresh displayName if Google gave us a richer one and the local user
    // hasn't customised it (default-derived from email local-part).
    const localUser = await prisma.user.findUnique({ where: { id: userId } });
    if (
      localUser &&
      completed.displayName &&
      localUser.displayName === deriveDisplayNameFromEmail(completed.email)
    ) {
      await prisma.user.update({
        where: { id: userId },
        data: { displayName: completed.displayName },
      });
    }

    await prisma.oAuthAccount.upsert({
      where: {
        provider_subjectId: {
          provider: 'google',
          subjectId: completed.subjectId,
        },
      },
      update: { userId },
      create: {
        provider: 'google',
        subjectId: completed.subjectId,
        userId,
      },
    });

    const token = generateToken();
    await prisma.token.create({ data: { token, userId, method: 'google' } });

    // Redirect ABSOLUTELY to PUBLIC_BASE_URL so dev (server :3001, vite
    // client :5173) lands on the SPA instead of staying on the API host.
    // Only include `token` and `returnTo` in the URL -- the SPA fetches
    // email/displayName via /api/auth/oauth/google/complete so they
    // don't need to ride along (and shouldn't leak into browser history
    // or the Referer header).
    const safeReturn = encodeURIComponent(completed.returnTo || '/');
    const target =
      `${getPublicBaseUrl()}/oauth/callback` +
      `?token=${encodeURIComponent(token)}` +
      `&returnTo=${safeReturn}`;
    res.redirect(target);
  } catch (error) {
    console.error('Google OAuth callback failed:', error);
    const msg = encodeURIComponent(
      error instanceof Error ? error.message : 'OAuth failed'
    );
    res.redirect(`${getPublicBaseUrl()}/oauth/callback?error=${msg}`);
  }
});

// SPA calls this after catching /oauth/callback?token=... in the URL. It
// verifies the token is fresh (created in the last few minutes) and returns
// the canonical AuthResponse.
app.post('/api/auth/oauth/google/complete', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });

  const tokenObj = await prisma.token.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!tokenObj || tokenObj.method !== 'google') {
    return res.status(401).json({ error: 'Invalid OAuth token' });
  }
  if (Date.now() - tokenObj.createdAt.getTime() > 5 * 60 * 1000) {
    return res.status(401).json({ error: 'OAuth token has expired' });
  }
  const user = tokenObj.user;
  // Single-use: burn the row so the URL can't be replayed (browser history,
  // Referer header, screen-share, etc.). After this call, the SPA already
  // stored AuthResponse in localStorage so the user keeps their session.
  // We catch a delete failure so a transient DB hiccup doesn't kick the
  // user out (the 5-min freshness window still bounds the leak).
  await prisma.token
    .delete({ where: { id: tokenObj.id } })
    .catch((err) =>
      console.error('OAuth token cleanup failed (row remains, will TTL via freshness):', err)
    );
  // Mint a separate, persistent session token T2. The redirect token T1
  // (above) has just been deleted from the DB; T2 is what the SPA stores in
  // localStorage and sends on every subsequent Authorization: Bearer …
  // call. Without this step every authenticated request after sign-in
  // would fail, because the bearer value the SPA received was destroyed
  // along with T1. Method 'google-session' makes the row easy to identify
  // in DB audits (the magic-link flow uses method='magic-link').
  const sessionToken = generateToken();
  await prisma.token.create({
    data: { token: sessionToken, userId: user.id, method: 'google-session' },
  });
  res.json({
      token: sessionToken,
      email: user.email,
      displayName: user.displayName,
      elo: user.elo,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Profile of the currently signed-in user.
app.get('/api/auth/profile', async (req, res) => {
  try {
    const identity = await getUserFromToken(req);
    if (!identity) return res.status(401).json({ error: 'Not authenticated' });

    const user = await prisma.user.findUnique({
      where: { id: identity.userId },
      include: { matchHistory: { orderBy: { date: 'desc' }, take: 25 } },
    });
    if (!user) return res.status(401).json({ error: 'User not found' });

    res.json({
      email: user.email,
      displayName: user.displayName,
      elo: user.elo,
      gamesPlayed: user.gamesPlayed,
      wins: user.wins,
      losses: user.losses,
      draws: user.draws,
      matchHistory: user.matchHistory.map((m) => ({
        gameId: m.gameId,
        opponent: m.opponent,
        result: m.result,
        date: m.date.getTime(),
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Serve built client in production ──
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  // Only serve index.html for non-API routes (fallback for SPA routing)
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Chess server running on http://localhost:${PORT}`);
});
