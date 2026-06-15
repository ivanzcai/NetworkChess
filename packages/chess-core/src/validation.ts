import { Piece, PieceType, Color, Square, Move, GameState, GameStatus, CastlingRights } from './types.js';
import { cloneBoard, squareInfo, squareFromFileRank, opponentColor } from './board.js';
import { generatePseudoLegalMoves, isSquareAttacked } from './moves.js';

// ── Apply a move to a board (no validation) ──
export function applyMove(
  board: (Piece | null)[],
  move: Move,
): { board: (Piece | null)[]; capturedPiece: Piece | null } {
  const newBoard = cloneBoard(board);
  const piece = newBoard[move.from];
  if (!piece) throw new Error('No piece at source square');

  const capturedPiece = newBoard[move.to];
  newBoard[move.to] = piece;
  newBoard[move.from] = null;

  // Pawn promotion
  if (move.promotion && piece.type === PieceType.Pawn) {
    newBoard[move.to] = { type: move.promotion, color: piece.color };
  }

  // En passant capture
  if (piece.type === PieceType.Pawn) {
    const { file: fromFile, rank: fromRank } = squareInfo(move.from);
    const { file: toFile, rank: toRank } = squareInfo(move.to);
    if (fromFile !== toFile && !capturedPiece) {
      // En passant: remove the captured pawn
      const capturedPawnSq = squareFromFileRank(toFile, fromRank);
      newBoard[capturedPawnSq] = null;
      return { board: newBoard, capturedPiece: { type: PieceType.Pawn, color: opponentColor(piece.color) } };
    }
  }

  // Castling: move the rook
  if (piece.type === PieceType.King) {
    const colDiff = (move.to % 8) - (move.from % 8);
    if (Math.abs(colDiff) === 2) {
      const rank = Math.floor(move.from / 8);
      if (colDiff === 2) {
        // Kingside
        newBoard[squareFromFileRank(5, rank)] = newBoard[squareFromFileRank(7, rank)];
        newBoard[squareFromFileRank(7, rank)] = null;
      } else {
        // Queenside
        newBoard[squareFromFileRank(3, rank)] = newBoard[squareFromFileRank(0, rank)];
        newBoard[squareFromFileRank(0, rank)] = null;
      }
    }
  }

  return { board: newBoard, capturedPiece };
}

// ── Generate legal moves (filter out moves that leave own king in check) ──
export function generateLegalMoves(state: GameState): Move[] {
  const { board, turn, castlingRights, enPassantSquare, kingsPosition } = state;
  const ownKing = kingsPosition[turn];

  const allPseudoMoves: Move[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (piece && piece.color === turn) {
      allPseudoMoves.push(...generatePseudoLegalMoves(board, sq, castlingRights, enPassantSquare));
    }
  }

  return allPseudoMoves.filter((move) => {
    const { board: afterBoard } = applyMove(board, move);
    const kingPos = move.from === ownKing
      ? move.to
      : ownKing;
    // If king was captured somehow, invalid
    if (!afterBoard[kingPos] || afterBoard[kingPos]?.type !== PieceType.King) return false;
    return !isSquareAttacked(afterBoard, kingPos, opponentColor(turn));
  });
}

// ── Check if the given color is in check ──
export function isInCheck(board: (Piece | null)[], color: Color, kingPos: Square): boolean {
  return isSquareAttacked(board, kingPos, opponentColor(color));
}

// ── Game Status ──
export function getGameStatus(
  board: (Piece | null)[],
  turn: Color,
  kingPos: Square,
  castlingRights: CastlingRights,
  enPassantSquare: Square | null,
  halfMoveClock: number,
  positionHistory: string[]
): GameStatus {
  const inCheck = isInCheck(board, turn, kingPos);

  // Check for legal moves
  const tempState: GameState = {
    board,
    turn,
    castlingRights,
    enPassantSquare,
    halfMoveClock,
    fullMoveNumber: 1,
    moveHistory: [],
    capturedPieces: { w: [], b: [] },
    kingsPosition: { [Color.White]: kingPos, [Color.Black]: kingPos },
  };
  const legalMoves = generateLegalMoves(tempState);

  if (legalMoves.length === 0) {
    if (inCheck) {
      return { type: 'checkmate', winner: opponentColor(turn) };
    }
    return { type: 'stalemate' };
  }

  // 50-move rule
  if (halfMoveClock >= 100) {
    return { type: 'draw', reason: 'fifty-move' };
  }

  // Threefold repetition
  const currentFen = positionHistory[positionHistory.length - 1]?.split(' ').slice(0, 4).join(' ');
  if (currentFen) {
    const count = positionHistory.filter(
      (fen) => fen.split(' ').slice(0, 4).join(' ') === currentFen
    ).length;
    if (count >= 3) {
      return { type: 'draw', reason: 'threefold' };
    }
  }

  // Insufficient material
  if (hasInsufficientMaterial(board)) {
    return { type: 'draw', reason: 'insufficient-material' };
  }

  if (inCheck) {
    return { type: 'check', color: turn };
  }

  return { type: 'active' };
}

function hasInsufficientMaterial(board: (Piece | null)[]): boolean {
  let count = 0;
  const pieceTypes: PieceType[] = [];
  const bishopSquares: { file: number; rank: number }[] = [];

  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (!piece) continue;
    count++;
    pieceTypes.push(piece.type);
    if (piece.type === PieceType.Bishop) {
      bishopSquares.push(squareInfo(sq));
    }
  }

  // King vs King
  if (count === 2) return true;

  // King + minor piece vs King
  if (count === 3) {
    const nonKingTypes = pieceTypes.filter((t) => t !== PieceType.King);
    if (nonKingTypes.length === 1) {
      const t = nonKingTypes[0];
      if (t === PieceType.Bishop || t === PieceType.Knight) return true;
    }
  }

  // King + Bishop vs King + Bishop (same color squares)
  if (count === 4) {
    const kingCount = pieceTypes.filter((t) => t === PieceType.King).length;
    if (kingCount === 2 && bishopSquares.length === 2) {
      const colors = bishopSquares.map((sq) => (sq.file + sq.rank) % 2);
      if (colors[0] === colors[1]) return true;
    }
  }

  return false;
}

// ── Update castling rights after a move ──
export function updateCastlingRights(
  board: (Piece | null)[],
  rights: CastlingRights,
  move: Move
): CastlingRights {
  const newRights: CastlingRights = JSON.parse(JSON.stringify(rights));
  const piece = board[move.from];
  if (!piece) return newRights;

  if (piece.type === PieceType.King) {
    newRights[piece.color].kingSide = false;
    newRights[piece.color].queenSide = false;
  }

  // If a rook moves from its starting square
  if (piece.type === PieceType.Rook) {
    if (piece.color === Color.White) {
      if (move.from === 0) newRights[Color.White].queenSide = false;
      if (move.from === 7) newRights[Color.White].kingSide = false;
    } else {
      if (move.from === 56) newRights[Color.Black].queenSide = false;
      if (move.from === 63) newRights[Color.Black].kingSide = false;
    }
  }

  // If a rook is captured on its starting square
  const captured = board[move.to];
  if (captured?.type === PieceType.Rook) {
    if (captured.color === Color.White) {
      if (move.to === 0) newRights[Color.White].queenSide = false;
      if (move.to === 7) newRights[Color.White].kingSide = false;
    } else {
      if (move.to === 56) newRights[Color.Black].queenSide = false;
      if (move.to === 63) newRights[Color.Black].kingSide = false;
    }
  }

  return newRights;
}

// ── Get en passant square after a move ──
export function getEnPassantSquare(
  board: (Piece | null)[],
  move: Move
): Square | null {
  const piece = board[move.from];
  if (!piece || piece.type !== PieceType.Pawn) return null;

  const { rank: fromRank } = squareInfo(move.from);
  const { rank: toRank, file: toFile } = squareInfo(move.to);

  if (Math.abs(toRank - fromRank) === 2) {
    return squareFromFileRank(toFile, (fromRank + toRank) / 2);
  }

  return null;
}
