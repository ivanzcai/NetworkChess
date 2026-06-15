import { Piece, PieceType, Color, Square, Move, CastlingRights } from './types.js';
import { squareInfo, isValidSquare, squareFromFileRank, opponentColor } from './board.js';

// ── Sliding Move Direction Vectors ──
const KNIGHT_MOVES = [-17, -15, -10, -6, 6, 10, 15, 17];
const BISHOP_DIRS = [-9, -7, 7, 9];
const ROOK_DIRS = [-8, -1, 1, 8];
const QUEEN_DIRS = [...BISHOP_DIRS, ...ROOK_DIRS];
const KING_MOVES = [...QUEEN_DIRS];

// ── Move Generation ──

export function generatePseudoLegalMoves(
  board: (Piece | null)[],
  square: Square,
  castlingRights: CastlingRights,
  enPassantSquare: Square | null
): Move[] {
  const piece = board[square];
  if (!piece) return [];

  switch (piece.type) {
    case PieceType.Pawn:
      return generatePawnMoves(board, square, piece.color, enPassantSquare);
    case PieceType.Knight:
      return generateKnightMoves(board, square, piece.color);
    case PieceType.Bishop:
      return generateSlidingMoves(board, square, piece.color, BISHOP_DIRS);
    case PieceType.Rook:
      return generateSlidingMoves(board, square, piece.color, ROOK_DIRS);
    case PieceType.Queen:
      return generateSlidingMoves(board, square, piece.color, QUEEN_DIRS);
    case PieceType.King:
      return generateKingMoves(board, square, piece.color, castlingRights);
    default:
      return [];
  }
}

export function generateAllPseudoLegalMoves(
  board: (Piece | null)[],
  color: Color,
  castlingRights: CastlingRights,
  enPassantSquare: Square | null
): Move[] {
  const moves: Move[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (piece && piece.color === color) {
      moves.push(...generatePseudoLegalMoves(board, sq, castlingRights, enPassantSquare));
    }
  }
  return moves;
}

// ── Pawn Moves ──
function generatePawnMoves(
  board: (Piece | null)[],
  sq: Square,
  color: Color,
  enPassantSquare: Square | null
): Move[] {
  const moves: Move[] = [];
  const { file, rank } = squareInfo(sq);
  const direction = color === Color.White ? 1 : -1;
  const startRank = color === Color.White ? 1 : 6;
  const promotionRank = color === Color.White ? 7 : 0;

  // Single push
  const oneForward = squareFromFileRank(file, rank + direction);
  if (isValidSquare(oneForward) && !board[oneForward]) {
    addPawnMoveOrPromotion(moves, sq, oneForward, rank + direction, promotionRank);

    // Double push from start
    const twoForward = squareFromFileRank(file, rank + 2 * direction);
    if (rank === startRank && !board[twoForward]) {
      moves.push({ from: sq, to: twoForward });
    }
  }

  // Captures
  for (const offset of [-1, 1]) {
    const captureFile = file + offset;
    if (captureFile < 0 || captureFile > 7) continue;
    const captureSq = squareFromFileRank(captureFile, rank + direction);
    if (!isValidSquare(captureSq)) continue;

    const target = board[captureSq];
    if (target && target.color !== color) {
      addPawnMoveOrPromotion(moves, sq, captureSq, rank + direction, promotionRank);
    }

    // En passant
    if (captureSq === enPassantSquare) {
      moves.push({ from: sq, to: captureSq });
    }
  }

  return moves;
}

function addPawnMoveOrPromotion(
  moves: Move[],
  from: Square,
  to: Square,
  newRank: number,
  promotionRank: number
): void {
  if (newRank === promotionRank) {
    for (const promo of [PieceType.Queen, PieceType.Rook, PieceType.Bishop, PieceType.Knight]) {
      moves.push({ from, to, promotion: promo });
    }
  } else {
    moves.push({ from, to });
  }
}

// ── Knight Moves ──
function generateKnightMoves(
  board: (Piece | null)[],
  sq: Square,
  color: Color
): Move[] {
  const moves: Move[] = [];
  const { file, rank } = squareInfo(sq);

  for (const offset of KNIGHT_MOVES) {
    const toSq = sq + offset;
    if (!isValidSquare(toSq)) continue;

    const toInfo = squareInfo(toSq);
    const fileDiff = Math.abs(file - toInfo.file);
    const rankDiff = Math.abs(rank - toInfo.rank);

    // Knight must move 2 in one direction and 1 in the other
    if (!((fileDiff === 2 && rankDiff === 1) || (fileDiff === 1 && rankDiff === 2))) continue;

    const target = board[toSq];
    if (!target || target.color !== color) {
      moves.push({ from: sq, to: toSq });
    }
  }

  return moves;
}

// ── Sliding Moves (Rook, Bishop, Queen) ──
function generateSlidingMoves(
  board: (Piece | null)[],
  sq: Square,
  color: Color,
  directions: number[]
): Move[] {
  const moves: Move[] = [];
  const { file, rank } = squareInfo(sq);

  for (const dir of directions) {
    for (let dist = 1; dist < 8; dist++) {
      const toSq = sq + dir * dist;
      if (!isValidSquare(toSq)) break;

      const toInfo = squareInfo(toSq);
      // Prevent wrapping around board edges for horizontal/diagonal moves
      const fileDiff = Math.abs(file - toInfo.file);
      const rankDiff = Math.abs(rank - toInfo.rank);

      // For diagonal moves: fileDiff must equal rankDiff and equal dist
      if ((dir === -9 || dir === -7 || dir === 7 || dir === 9) && (fileDiff !== dist || rankDiff !== dist)) break;
      // For vertical/horizontal: one diff must be dist, other must be 0
      if ((dir === -8 || dir === 8) && (fileDiff !== 0 || rankDiff !== dist)) break;
      if ((dir === -1 || dir === 1) && (rankDiff !== 0 || fileDiff !== dist)) break;

      const target = board[toSq];
      if (target) {
        if (target.color !== color) {
          moves.push({ from: sq, to: toSq });
        }
        break;
      }
      moves.push({ from: sq, to: toSq });
    }
  }

  return moves;
}

// ── King Moves ──
function generateKingMoves(
  board: (Piece | null)[],
  sq: Square,
  color: Color,
  castlingRights: CastlingRights
): Move[] {
  const moves: Move[] = [];
  const { file, rank } = squareInfo(sq);

  for (const dir of KING_MOVES) {
    const toSq = sq + dir;
    if (!isValidSquare(toSq)) continue;

    const toInfo = squareInfo(toSq);
    const fileDiff = Math.abs(file - toInfo.file);
    const rankDiff = Math.abs(rank - toInfo.rank);
    if (fileDiff > 1 || rankDiff > 1) continue;

    const target = board[toSq];
    if (!target || target.color !== color) {
      moves.push({ from: sq, to: toSq });
    }
  }

  // Castling
  const rights = castlingRights[color];
  const backRank = color === Color.White ? 0 : 7;

  if (rights.kingSide) {
    const f = squareFromFileRank(5, backRank);
    const g = squareFromFileRank(6, backRank);
    if (!board[f] && !board[g]) {
      // Verify rook is present
      const rookSq = squareFromFileRank(7, backRank);
      const rook = board[rookSq];
      if (rook && rook.type === PieceType.Rook && rook.color === color) {
        moves.push({ from: sq, to: g });
      }
    }
  }

  if (rights.queenSide) {
    const d = squareFromFileRank(3, backRank);
    const c = squareFromFileRank(2, backRank);
    const b = squareFromFileRank(1, backRank);
    if (!board[d] && !board[c] && !board[b]) {
      const rookSq = squareFromFileRank(0, backRank);
      const rook = board[rookSq];
      if (rook && rook.type === PieceType.Rook && rook.color === color) {
        moves.push({ from: sq, to: c });
      }
    }
  }

  return moves;
}

// ── Check if a square is attacked by a given color ──
export function isSquareAttacked(
  board: (Piece | null)[],
  sq: Square,
  attackerColor: Color
): boolean {
  const { file, rank } = squareInfo(sq);

  // Pawn attacks
  const pawnDir = attackerColor === Color.White ? -1 : 1;
  for (const fileOff of [-1, 1]) {
    const attackFile = file + fileOff;
    if (attackFile < 0 || attackFile > 7) continue;
    const attackSq = squareFromFileRank(attackFile, rank + pawnDir);
    if (!isValidSquare(attackSq)) continue;
    const p = board[attackSq];
    if (p?.type === PieceType.Pawn && p.color === attackerColor) return true;
  }

  // Knight attacks
  for (const offset of KNIGHT_MOVES) {
    const attackSq = sq + offset;
    if (!isValidSquare(attackSq)) continue;
    const toInfo = squareInfo(attackSq);
    const fileDiff = Math.abs(file - toInfo.file);
    const rankDiff = Math.abs(rank - toInfo.rank);
    if ((fileDiff === 2 && rankDiff === 1) || (fileDiff === 1 && rankDiff === 2)) {
      const p = board[attackSq];
      if (p?.type === PieceType.Knight && p.color === attackerColor) return true;
    }
  }

  // King attacks
  for (const dir of KING_MOVES) {
    const attackSq = sq + dir;
    if (!isValidSquare(attackSq)) continue;
    const toInfo = squareInfo(attackSq);
    const fileDiff = Math.abs(file - toInfo.file);
    const rankDiff = Math.abs(rank - toInfo.rank);
    if (fileDiff <= 1 && rankDiff <= 1) {
      const p = board[attackSq];
      if (p?.type === PieceType.King && p.color === attackerColor) return true;
    }
  }

  // Sliding piece attacks (queen, rook, bishop)
  for (const dir of QUEEN_DIRS) {
    for (let dist = 1; dist < 8; dist++) {
      const attackSq = sq + dir * dist;
      if (!isValidSquare(attackSq)) break;

      const toInfo = squareInfo(attackSq);
      const fileDiff = Math.abs(file - toInfo.file);
      const rankDiff = Math.abs(rank - toInfo.rank);

      // Prevent wrapping
      if ((dir === -9 || dir === -7 || dir === 7 || dir === 9) && (fileDiff !== dist || rankDiff !== dist)) break;
      if ((dir === -8 || dir === 8) && (fileDiff !== 0 || rankDiff !== dist)) break;
      if ((dir === -1 || dir === 1) && (rankDiff !== 0 || fileDiff !== dist)) break;

      const p = board[attackSq];
      if (p) {
        if (p.color !== attackerColor) break;
        if (p.color === attackerColor) {
          const isDiagonal = dir === -9 || dir === -7 || dir === 7 || dir === 9;
          if (p.type === PieceType.Queen) return true;
          if (isDiagonal && p.type === PieceType.Bishop) return true;
          if (!isDiagonal && p.type === PieceType.Rook) return true;
          break;
        }
      }
    }
  }

  return false;
}
