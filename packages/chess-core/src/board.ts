import { Color, Piece, PieceType, Square, SquareInfo, CastlingRights } from './types.js';

// ── Square Helpers ──
export function squareToAlgebraic(sq: Square): string {
  const file = sq % 8;
  const rank = Math.floor(sq / 8);
  return String.fromCharCode(97 + file) + (rank + 1);
}

export function algebraicToSquare(alg: string): Square {
  const file = alg.charCodeAt(0) - 97;
  const rank = parseInt(alg[1]) - 1;
  return rank * 8 + file;
}

export function squareInfo(sq: Square): SquareInfo {
  return { file: sq % 8, rank: Math.floor(sq / 8) };
}

export function squareFromFileRank(file: number, rank: number): Square {
  return rank * 8 + file;
}

export function isValidSquare(sq: number): boolean {
  return sq >= 0 && sq < 64;
}

// ── Board Initialization ──
export function createInitialBoard(): (Piece | null)[] {
  const board: (Piece | null)[] = new Array(64).fill(null);

  // Pawns
  for (let file = 0; file < 8; file++) {
    board[squareFromFileRank(file, 1)] = { type: PieceType.Pawn, color: Color.White };
    board[squareFromFileRank(file, 6)] = { type: PieceType.Pawn, color: Color.Black };
  }

  // Pieces
  const pieceOrder: PieceType[] = [
    PieceType.Rook, PieceType.Knight, PieceType.Bishop, PieceType.Queen,
    PieceType.King, PieceType.Bishop, PieceType.Knight, PieceType.Rook,
  ];

  for (let file = 0; file < 8; file++) {
    board[squareFromFileRank(file, 0)] = { type: pieceOrder[file], color: Color.White };
    board[squareFromFileRank(file, 7)] = { type: pieceOrder[file], color: Color.Black };
  }

  return board;
}

export function cloneBoard(board: (Piece | null)[]): (Piece | null)[] {
  return board.map((p) => (p ? { ...p } : null));
}

// ── Piece Display ──
export function pieceToChar(piece: Piece): string {
  const chars: Record<string, string> = {
    wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
    bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚',
  };
  return chars[piece.color + piece.type] || '?';
}

export function pieceToFenChar(piece: Piece | null): string {
  if (!piece) return '';
  const c = piece.type.toUpperCase();
  return piece.color === Color.White ? c : c.toLowerCase();
}

export function opponentColor(color: Color): Color {
  return color === Color.White ? Color.Black : Color.White;
}

// ── King Position ──
export function findKing(board: (Piece | null)[], color: Color): Square {
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (piece?.type === PieceType.King && piece.color === color) {
      return sq;
    }
  }
  throw new Error('King not found on board');
}

// ── Castling ──
export function createInitialCastlingRights(): CastlingRights {
  return {
    [Color.White]: { kingSide: true, queenSide: true },
    [Color.Black]: { kingSide: true, queenSide: true },
  };
}
