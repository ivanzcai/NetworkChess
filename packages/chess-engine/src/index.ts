import {
  GameState,
  Move,
  PieceType,
  Color,
  Piece,
  getLegalMoves,
  makeMove,
  createInitialGameState,
  applyMove,
  squareInfo,
  opponentColor,
  isSquareAttacked,
} from '@network-chess/core';

// ── Piece Values ──
const PIECE_VALUES: Record<PieceType, number> = {
  [PieceType.Pawn]: 100,
  [PieceType.Knight]: 320,
  [PieceType.Bishop]: 330,
  [PieceType.Rook]: 500,
  [PieceType.Queen]: 900,
  [PieceType.King]: 20000,
};

// ── Piece-Square Tables (White perspective, flipped for Black) ──
const PAWN_TABLE = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];

const KNIGHT_TABLE = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];

const BISHOP_TABLE = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];

const ROOK_TABLE = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];

const QUEEN_TABLE = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];

const KING_MIDDLE_TABLE = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];

const KING_END_TABLE = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];

const PST: Record<PieceType, number[]> = {
  [PieceType.Pawn]: PAWN_TABLE,
  [PieceType.Knight]: KNIGHT_TABLE,
  [PieceType.Bishop]: BISHOP_TABLE,
  [PieceType.Rook]: ROOK_TABLE,
  [PieceType.Queen]: QUEEN_TABLE,
  [PieceType.King]: KING_MIDDLE_TABLE,
};

// ── Evaluation ──
function getSquareIndex(sq: number, color: Color): number {
  return color === Color.White ? sq : 63 - sq;
}

function evaluateBoard(board: (Piece | null)[], isEndgame: boolean): number {
  let score = 0;

  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (!piece) continue;

    const value = PIECE_VALUES[piece.type];
    const table = piece.type === PieceType.King && isEndgame ? KING_END_TABLE : PST[piece.type];
    const idx = getSquareIndex(sq, piece.color);
    const positional = table[idx];

    if (piece.color === Color.White) {
      score += value + positional;
    } else {
      score -= value + positional;
    }
  }

  return score;
}

function isEndgame(board: (Piece | null)[]): boolean {
  let totalMaterial = 0;
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (piece && piece.type !== PieceType.King) {
      totalMaterial += PIECE_VALUES[piece.type];
    }
  }
  return totalMaterial < 2500;
}

function evaluate(state: GameState): number {
  const score = evaluateBoard(state.board, isEndgame(state.board));
  return state.turn === Color.White ? score : -score;
}

// ── Move Ordering ──
const MVV_LVA: Record<PieceType, number> = {
  [PieceType.Pawn]: 1,
  [PieceType.Knight]: 2,
  [PieceType.Bishop]: 3,
  [PieceType.Rook]: 4,
  [PieceType.Queen]: 5,
  [PieceType.King]: 6,
};

function orderMoves(moves: Move[], state: GameState): Move[] {
  return moves.sort((a, b) => {
    // Promotions first
    if (a.promotion && !b.promotion) return -1;
    if (!a.promotion && b.promotion) return 1;
    if (a.promotion && b.promotion) {
      return PIECE_VALUES[b.promotion] - PIECE_VALUES[a.promotion];
    }

    // Captures next (MVV-LVA)
    const aVictim = state.board[a.to];
    const bVictim = state.board[b.to];
    const aScore = aVictim ? MVV_LVA[aVictim.type] * 10 - MVV_LVA[state.board[a.from]!.type] : 0;
    const bScore = bVictim ? MVV_LVA[bVictim.type] * 10 - MVV_LVA[state.board[b.from]!.type] : 0;
    return bScore - aScore;
  });
}

// ── Minimax with Alpha-Beta ──
function minimax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean
): number {
  if (depth === 0) {
    return evaluate(state);
  }

  const moves = getLegalMoves(state);
  if (moves.length === 0) {
    // Checkmate or stalemate: check if the king is in check
    const inCheck = isSquareAttacked(state.board, state.kingsPosition[state.turn], opponentColor(state.turn));
    if (inCheck) {
      // Checkmate: bad for side to move
      if (maximizing) return -99999 + (10 - depth);
      return 99999 - (10 - depth);
    }
    // Stalemate: draw
    return 0;
  }

  const orderedMoves = orderMoves(moves, state);

  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of orderedMoves) {
      const { newState } = makeMove(state, move);
      const evalScore = minimax(newState, depth - 1, alpha, beta, false);
      maxEval = Math.max(maxEval, evalScore);
      alpha = Math.max(alpha, evalScore);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of orderedMoves) {
      const { newState } = makeMove(state, move);
      const evalScore = minimax(newState, depth - 1, alpha, beta, true);
      minEval = Math.min(minEval, evalScore);
      beta = Math.min(beta, evalScore);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

// ── Public API ──
export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_DEPTH: Record<Difficulty, number> = {
  easy: 1,
  medium: 3,
  hard: 5,
};

export interface EngineOptions {
  depth?: number; // default 3
  difficulty?: Difficulty; // overrides depth if set
}

export function getBestMove(state: GameState, options: EngineOptions = {}): Move | null {
  const depth = options.difficulty
    ? (DIFFICULTY_DEPTH[options.difficulty] ?? 3)
    : (options.depth ?? 3);
  const legalMoves = getLegalMoves(state);

  if (legalMoves.length === 0) return null;
  if (legalMoves.length === 1) return legalMoves[0];

  const maximizing = state.turn === Color.White;
  let bestMove: Move = legalMoves[0];
  let bestValue = maximizing ? -Infinity : Infinity;

  const orderedMoves = orderMoves(legalMoves, state);

  for (const move of orderedMoves) {
    const { newState } = makeMove(state, move);
    const value = minimax(newState, depth - 1, -Infinity, Infinity, !maximizing);

    if (maximizing) {
      if (value > bestValue) {
        bestValue = value;
        bestMove = move;
      }
    } else {
      if (value < bestValue) {
        bestValue = value;
        bestMove = move;
      }
    }
  }

  return bestMove;
}

export function getBestMoveWithTime(state: GameState, timeMs: number = 1000): Move | null {
  const startTime = Date.now();
  let depth = 1;
  let bestMove: Move | null = null;

  while (true) {
    const move = getBestMove(state, { depth });
    if (move) bestMove = move;

    const elapsed = Date.now() - startTime;
    if (elapsed > timeMs * 0.5 || depth >= 6) {
      break;
    }
    depth++;
  }

  return bestMove;
}
