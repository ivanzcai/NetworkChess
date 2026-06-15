import { Piece, PieceType, Color, CastlingRights } from './types.js';
import { squareFromFileRank } from './board.js';

// FEN format: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
export function parseFen(fen: string): {
  board: (Piece | null)[];
  turn: Color;
  castlingRights: CastlingRights;
  enPassantSquare: number | null;
  halfMoveClock: number;
  fullMoveNumber: number;
} {
  const board: (Piece | null)[] = new Array(64).fill(null);
  const parts = fen.split(' ');
  const position = parts[0];
  const ranks = position.split('/');

  if (ranks.length !== 8) {
    throw new Error('Invalid FEN: must have 8 ranks');
  }

  for (let rank = 0; rank < 8; rank++) {
    const rankStr = ranks[7 - rank]; // FEN starts from rank 8
    let file = 0;
    for (const char of rankStr) {
      if (char >= '1' && char <= '8') {
        file += parseInt(char);
      } else {
        const color = char === char.toUpperCase() ? Color.White : Color.Black;
        const typeMap: Record<string, PieceType> = {
          p: PieceType.Pawn,
          n: PieceType.Knight,
          b: PieceType.Bishop,
          r: PieceType.Rook,
          q: PieceType.Queen,
          k: PieceType.King,
        };
        const type = typeMap[char.toLowerCase()];
        if (!type) throw new Error(`Invalid piece character: ${char}`);
        board[squareFromFileRank(file, rank)] = { type, color };
        file++;
      }
    }
  }

  const turn = parts[1] === 'w' ? Color.White : Color.Black;

  const castlingStr = parts[2];
  const castlingRights: CastlingRights = {
    [Color.White]: {
      kingSide: castlingStr.includes('K'),
      queenSide: castlingStr.includes('Q'),
    },
    [Color.Black]: {
      kingSide: castlingStr.includes('k'),
      queenSide: castlingStr.includes('q'),
    },
  };

  const enPassant = parts[3];
  const enPassantSquare = enPassant === '-' ? null : squareFromFileRank(
    enPassant.charCodeAt(0) - 97,
    parseInt(enPassant[1]) - 1
  );

  const halfMoveClock = parseInt(parts[4]) || 0;
  const fullMoveNumber = parseInt(parts[5]) || 1;

  return { board, turn, castlingRights, enPassantSquare, halfMoveClock, fullMoveNumber };
}

export function toFen(
  board: (Piece | null)[],
  turn: Color,
  castlingRights: CastlingRights,
  enPassantSquare: number | null,
  halfMoveClock: number,
  fullMoveNumber: number
): string {
  let fen = '';

  // Board position
  for (let rank = 7; rank >= 0; rank--) {
    let emptyCount = 0;
    for (let file = 0; file < 8; file++) {
      const sq = squareFromFileRank(file, rank);
      const piece = board[sq];
      if (piece) {
        if (emptyCount > 0) {
          fen += emptyCount;
          emptyCount = 0;
        }
        const char = piece.type.toUpperCase();
        fen += piece.color === Color.White ? char : char.toLowerCase();
      } else {
        emptyCount++;
      }
    }
    if (emptyCount > 0) fen += emptyCount;
    if (rank > 0) fen += '/';
  }

  // Turn
  fen += ' ' + turn;

  // Castling
  let castling = '';
  if (castlingRights[Color.White].kingSide) castling += 'K';
  if (castlingRights[Color.White].queenSide) castling += 'Q';
  if (castlingRights[Color.Black].kingSide) castling += 'k';
  if (castlingRights[Color.Black].queenSide) castling += 'q';
  fen += ' ' + (castling || '-');

  // En passant
  if (enPassantSquare !== null) {
    const file = String.fromCharCode(97 + (enPassantSquare % 8));
    const rank = Math.floor(enPassantSquare / 8) + 1;
    fen += ' ' + file + rank;
  } else {
    fen += ' -';
  }

  // Clocks
  fen += ' ' + halfMoveClock;
  fen += ' ' + fullMoveNumber;

  return fen;
}

// Move to algebraic notation
export function moveToAlgebraic(
  board: (Piece | null)[],
  move: { from: number; to: number; promotion?: PieceType }
): string {
  const fileFrom = String.fromCharCode(97 + (move.from % 8));
  const rankFrom = Math.floor(move.from / 8) + 1;
  const fileTo = String.fromCharCode(97 + (move.to % 8));
  const rankTo = Math.floor(move.to / 8) + 1;

  let notation = fileFrom + rankFrom + fileTo + rankTo;
  if (move.promotion) {
    notation += move.promotion;
  }
  return notation;
}

export function algebraicToMove(alg: string): { from: number; to: number; promotion?: PieceType } {
  const fileFrom = alg.charCodeAt(0) - 97;
  const rankFrom = parseInt(alg[1]) - 1;
  const fileTo = alg.charCodeAt(2) - 97;
  const rankTo = parseInt(alg[3]) - 1;

  const move: { from: number; to: number; promotion?: PieceType } = {
    from: squareFromFileRank(fileFrom, rankFrom),
    to: squareFromFileRank(fileTo, rankTo),
  };

  if (alg.length === 5) {
    const promoMap: Record<string, PieceType> = {
      q: PieceType.Queen,
      r: PieceType.Rook,
      b: PieceType.Bishop,
      n: PieceType.Knight,
    };
    move.promotion = promoMap[alg[4].toLowerCase()];
  }

  return move;
}
