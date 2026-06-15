// ── Piece Types ──
export enum PieceType {
  Pawn = 'p',
  Knight = 'n',
  Bishop = 'b',
  Rook = 'r',
  Queen = 'q',
  King = 'k',
}

export enum Color {
  White = 'w',
  Black = 'b',
}

export interface Piece {
  type: PieceType;
  color: Color;
}

export type Square = number; // 0-63, a1=0, h8=63

export interface Move {
  from: Square;
  to: Square;
  promotion?: PieceType;
}

export interface CastlingRights {
  [Color.White]: { kingSide: boolean; queenSide: boolean };
  [Color.Black]: { kingSide: boolean; queenSide: boolean };
}

export interface GameState {
  board: (Piece | null)[];
  turn: Color;
  castlingRights: CastlingRights;
  enPassantSquare: Square | null;
  halfMoveClock: number;
  fullMoveNumber: number;
  moveHistory: Move[];
  capturedPieces: { [Color.White]: Piece[]; [Color.Black]: Piece[] };
  kingsPosition: { [Color.White]: Square; [Color.Black]: Square };
}

export type GameStatus =
  | { type: 'active' }
  | { type: 'check'; color: Color }
  | { type: 'checkmate'; winner: Color }
  | { type: 'stalemate' }
  | { type: 'draw'; reason: 'fifty-move' | 'threefold' | 'insufficient-material' | 'agreement' };

export interface SquareInfo {
  file: number; // 0-7 (a-h)
  rank: number; // 0-7 (1-8)
}
