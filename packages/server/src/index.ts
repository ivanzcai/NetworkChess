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

const app = express();
const PORT = process.env.PORT || 3001;

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/chess?schema=public";
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

app.use(cors());
app.use(express.json());

// ── Game Connection Storage (in-memory) ──
const activeSseClients: Map<string, Set<(data: string) => void>> = new Map();

function serializeGameFromDb(game: any): Record<string, unknown> {
  const state = JSON.parse(game.stateJson) as GameState;
  const status = JSON.parse(game.statusJson) as GameStatus;

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
    moveHistory: state.moveHistory.map((m) => ({
      from: m.from,
      to: m.to,
      promotion: m.promotion || null,
      san: moveToSan(state, m),
    })),
    capturedPieces: {
      w: state.capturedPieces[Color.White].map((p) => ({ type: p.type, color: p.color })),
      b: state.capturedPieces[Color.Black].map((p) => ({ type: p.type, color: p.color })),
    },
    gameType: game.gameType,
    playerColor: game.playerColor,
    difficulty: game.difficulty,
    fullMoveNumber: state.fullMoveNumber,
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

async function createGame(gameType: 'pve' | 'pvp', playerColor: Color = Color.White, difficulty: Difficulty = 'medium') {
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
    }
  });

  return game;
}

function applyMoveToGameState(state: GameState, positionHistory: string[], move: Move): { newState: GameState; newHistory: string[]; fen: string; status: GameStatus } {
  const { newState } = makeMove(state, move);
  const fen = toFen(
    newState.board, newState.turn, newState.castlingRights,
    newState.enPassantSquare, newState.halfMoveClock, newState.fullMoveNumber
  );
  const newHistory = [...positionHistory, fen];

  // Compute status with full position history for threefold detection
  const status = getGameStatus(
    newState.board, newState.turn, newState.kingsPosition[newState.turn],
    newState.castlingRights, newState.enPassantSquare, newState.halfMoveClock,
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
        createdAt: {
          lt: oneHourAgo,
        },
      },
      select: {
        id: true,
      },
    });

    if (staleGames.length > 0) {
      const ids = staleGames.map(g => g.id);
      await prisma.game.deleteMany({
        where: {
          id: {
            in: ids,
          },
        },
      });
      // Clean up in-memory SSE clients too
      for (const id of ids) {
        activeSseClients.delete(id);
      }
    }
  } catch (error) {
    console.error('Failed to cleanup stale games:', error);
  }
}, 10 * 60 * 1000);

// ── REST Endpoints ──

// Create a new game (PvE or PvP)
app.post('/api/games', async (req, res) => {
  try {
    const { gameType = 'pve', playerColor = 'w', difficulty = 'medium' } = req.body;
    const color = playerColor === 'b' ? Color.Black : Color.White;
    const game = await createGame(gameType, color, difficulty as Difficulty);

    let state = JSON.parse(game.stateJson) as GameState;

    // If player chose black in PvE, AI makes first move
    if (game.gameType === 'pve' && color === Color.Black) {
      const aiMove = getBestMove(state, { difficulty: game.difficulty as Difficulty });
      if (aiMove) {
        const positionHistory = JSON.parse(game.positionHistory) as string[];
        const { newState, newHistory, status: newStatus } = applyMoveToGameState(state, positionHistory, aiMove);
        
        const updatedGame = await prisma.game.update({
          where: { id: game.id },
          data: {
            stateJson: JSON.stringify(newState),
            statusJson: JSON.stringify(newStatus),
            positionHistory: JSON.stringify(newHistory),
          }
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
    const game = await prisma.game.findUnique({ where: { id: req.params.id.toLowerCase() } });
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    if (game.gameType !== 'pvp') {
      return res.status(400).json({ error: 'Not a PvP game' });
    }
    if (game.playerCount && game.playerCount >= 2) {
      return res.status(400).json({ error: 'Game is full' });
    }

    const joinerColor = game.playerColor === Color.White ? Color.Black : Color.White;
    
    const updatedGame = await prisma.game.update({
      where: { id: game.id },
      data: {
        playerCount: 2
      }
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
    const game = await prisma.game.findUnique({ where: { id: req.params.id.toLowerCase() } });
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    res.json(serializeGameFromDb(game));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Make a move
app.post('/api/games/:id/move', async (req, res) => {
  try {
    const game = await prisma.game.findUnique({ where: { id: req.params.id.toLowerCase() } });
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

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

    // Apply player move
    const { newState, newHistory, status: newStatus } = applyMoveToGameState(state, positionHistory, move);

    // Save back to db
    const updatedGame = await prisma.game.update({
      where: { id: game.id },
      data: {
        stateJson: JSON.stringify(newState),
        statusJson: JSON.stringify(newStatus),
        positionHistory: JSON.stringify(newHistory),
      }
    });

    const serialized = serializeGameFromDb(updatedGame);
    broadcastGame(game.id, serialized);

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

          const aiMove = getBestMove(latestState, { difficulty: latestGame.difficulty as Difficulty });
          if (aiMove) {
            const { newState: aiState, newHistory: aiHistory, status: aiStatus } = applyMoveToGameState(latestState, latestHistory, aiMove);

            const aiUpdatedGame = await prisma.game.update({
              where: { id: game.id },
              data: {
                stateJson: JSON.stringify(aiState),
                statusJson: JSON.stringify(aiStatus),
                positionHistory: JSON.stringify(aiHistory),
              }
            });

            const aiSerialized = serializeGameFromDb(aiUpdatedGame);
            broadcastGame(game.id, aiSerialized);
          }
        } catch (err) {
          console.error("Error in AI move execution:", err);
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
    const game = await prisma.game.findUnique({ where: { id: req.params.id.toLowerCase() } });
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

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
    const game = await prisma.game.findUnique({ where: { id: req.params.id.toLowerCase() } });
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

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
      if (clients?.size === 0) {
        activeSseClients.delete(game.id);
      }
    });
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

// ── Auth (Prisma-backed) ──

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + 'chess-salt').digest('hex');
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || username.length < 2 || password.length < 4) {
      return res.status(400).json({ error: 'Invalid username or password (min 2 chars / 4 chars)' });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        username: {
          equals: username,
          mode: 'insensitive'
        }
      }
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        elo: 1200,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      }
    });

    const token = generateToken();
    await prisma.token.create({
      data: {
        token,
        username: user.username,
      }
    });

    res.json({ token, username: user.username, elo: user.elo });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.user.findFirst({
      where: {
        username: {
          equals: username,
          mode: 'insensitive'
        }
      }
    });

    if (!user || user.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken();
    await prisma.token.create({
      data: {
        token,
        username: user.username,
      }
    });

    res.json({ token, username: user.username, elo: user.elo });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Guest login
app.post('/api/auth/guest', async (_req, res) => {
  try {
    const guestName = 'Guest_' + crypto.randomBytes(3).toString('hex');
    const token = generateToken();

    const user = await prisma.user.create({
      data: {
        username: guestName,
        passwordHash: '',
        elo: 1000,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      }
    });

    await prisma.token.create({
      data: {
        token,
        username: guestName,
      }
    });

    res.json({ token, username: guestName, elo: 1000 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user profile
app.get('/api/auth/profile', async (req, res) => {
  try {
    const tokenVal = req.headers.authorization?.replace('Bearer ', '');
    if (!tokenVal) return res.status(401).json({ error: 'No token' });

    const tokenObj = await prisma.token.findUnique({
      where: { token: tokenVal },
      include: {
        user: {
          include: {
            matchHistory: true
          }
        }
      }
    });

    if (!tokenObj) return res.status(401).json({ error: 'Invalid token' });
    const user = tokenObj.user;

    res.json({
      username: user.username,
      elo: user.elo,
      gamesPlayed: user.gamesPlayed,
      wins: user.wins,
      losses: user.losses,
      draws: user.draws,
      matchHistory: user.matchHistory.map(m => ({
        gameId: m.gameId,
        opponent: m.opponent,
        result: m.result,
        date: m.date.getTime()
      }))
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
