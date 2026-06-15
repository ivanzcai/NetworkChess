export { PieceType, Color } from './types.js';
export type { Piece, Square, Move, CastlingRights, GameState, GameStatus, SquareInfo } from './types.js';

export {
  squareToAlgebraic,
  algebraicToSquare,
  squareInfo,
  squareFromFileRank,
  isValidSquare,
  createInitialBoard,
  cloneBoard,
  pieceToChar,
  pieceToFenChar,
  opponentColor,
  findKing,
  createInitialCastlingRights,
} from './board.js';

export {
  generatePseudoLegalMoves,
  generateAllPseudoLegalMoves,
  isSquareAttacked,
} from './moves.js';

export {
  applyMove,
  generateLegalMoves,
  isInCheck,
  getGameStatus,
  updateCastlingRights,
  getEnPassantSquare,
} from './validation.js';

export { parseFen, toFen, moveToAlgebraic, algebraicToMove } from './fen.js';

export {
  createInitialGameState,
  makeMove,
  getLegalMoves,
  isMoveLegal,
  moveToSan,
} from './game.js';
