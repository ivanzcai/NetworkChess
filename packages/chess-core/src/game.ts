import { Color, GameState, Move, Piece, PieceType, GameStatus } from './types.js';
import { createInitialBoard, findKing, createInitialCastlingRights } from './board.js';
import { applyMove, generateLegalMoves, updateCastlingRights, getEnPassantSquare, getGameStatus } from './validation.js';
import { toFen } from './fen.js';

export function createInitialGameState(): GameState {
  const board = createInitialBoard();
  return {
    board,
    turn: Color.White,
    castlingRights: createInitialCastlingRights(),
    enPassantSquare: null,
    halfMoveClock: 0,
    fullMoveNumber: 1,
    moveHistory: [],
    capturedPieces: { [Color.White]: [], [Color.Black]: [] },
    kingsPosition: {
      [Color.White]: findKing(board, Color.White),
      [Color.Black]: findKing(board, Color.Black),
    },
  };
}

export function makeMove(
  state: GameState,
  move: Move
): { newState: GameState; status: GameStatus; positionHistory: string[] } {
  const { board, capturedPiece } = applyMove(state.board, move);
  const piece = state.board[move.from]!;

  // Update captured pieces
  const capturedPieces = {
    [Color.White]: [...state.capturedPieces[Color.White]],
    [Color.Black]: [...state.capturedPieces[Color.Black]],
  };
  if (capturedPiece) {
    capturedPieces[piece.color].push(capturedPiece);
  }

  // Update kings position
  const kingsPosition = { ...state.kingsPosition };
  if (piece.type === PieceType.King) {
    kingsPosition[piece.color] = move.to;
  }

  // Update castling rights
  const newCastlingRights = updateCastlingRights(state.board, state.castlingRights, move);

  // En passant
  const enPassantSquare = getEnPassantSquare(state.board, move);

  // Half move clock
  const isCapture = capturedPiece !== null || (piece.type === PieceType.Pawn && move.from % 8 !== move.to % 8 && !state.board[move.to]);
  const isPawnMove = piece.type === PieceType.Pawn;
  const halfMoveClock = isCapture || isPawnMove ? 0 : state.halfMoveClock + 1;

  // Full move number
  const fullMoveNumber = state.turn === Color.Black ? state.fullMoveNumber + 1 : state.fullMoveNumber;

  const newState: GameState = {
    board,
    turn: state.turn === Color.White ? Color.Black : Color.White,
    castlingRights: newCastlingRights,
    enPassantSquare,
    halfMoveClock,
    fullMoveNumber,
    moveHistory: [...state.moveHistory, move],
    capturedPieces,
    kingsPosition,
  };

  // Generate position history for threefold detection (stored externally)
  const fen = toFen(
    newState.board,
    newState.turn,
    newState.castlingRights,
    newState.enPassantSquare,
    newState.halfMoveClock,
    newState.fullMoveNumber
  );

  const status = getGameStatus(
    newState.board,
    newState.turn,
    kingsPosition[newState.turn],
    newState.castlingRights,
    newState.enPassantSquare,
    newState.halfMoveClock,
    [fen] // Position history is managed by the caller
  );

  return { newState, status, positionHistory: [fen] };
}

export function getLegalMoves(state: GameState): Move[] {
  return generateLegalMoves(state);
}

export function isMoveLegal(state: GameState, move: Move): boolean {
  const legalMoves = generateLegalMoves(state);
  return legalMoves.some(
    (m) =>
      m.from === move.from &&
      m.to === move.to &&
      (m.promotion || undefined) === (move.promotion || undefined)
  );
}

// Convert move to standard algebraic notation (e.g., "e4", "Nf3", "O-O")
export function moveToSan(state: GameState, move: Move): string {
  const piece = state.board[move.from];
  if (!piece) return '??';

  const fileFrom = String.fromCharCode(97 + (move.from % 8));
  const rankFrom = Math.floor(move.from / 8) + 1;
  const fileTo = String.fromCharCode(97 + (move.to % 8));
  const rankTo = Math.floor(move.to / 8) + 1;

  // Castling
  if (piece.type === PieceType.King) {
    const colDiff = move.to % 8 - move.from % 8;
    if (colDiff === 2) return 'O-O';
    if (colDiff === -2) return 'O-O-O';
  }

  let notation = '';

  if (piece.type !== PieceType.Pawn) {
    notation += piece.type.toUpperCase();

    // Disambiguation
    const legalMoves = getLegalMoves(state);
    const ambiguous = legalMoves.filter(
      (m) =>
        m.to === move.to &&
        m.from !== move.from &&
        state.board[m.from]?.type === piece.type
    );

    if (ambiguous.length > 0) {
      const sameFile = ambiguous.some((m) => m.from % 8 === move.from % 8);
      const sameRank = ambiguous.some(
        (m) => Math.floor(m.from / 8) === Math.floor(move.from / 8)
      );

      if (!sameFile) {
        notation += fileFrom;
      } else if (!sameRank) {
        notation += rankFrom;
      } else {
        notation += fileFrom + rankFrom;
      }
    }
  }

  // Capture
  const captured = state.board[move.to];
  const isEnPassant =
    piece.type === PieceType.Pawn &&
    move.from % 8 !== move.to % 8 &&
    !captured;

  if (captured || isEnPassant) {
    if (piece.type === PieceType.Pawn) {
      notation += fileFrom;
    }
    notation += 'x';
  }

  notation += fileTo + rankTo;

  // Promotion
  if (move.promotion) {
    notation += '=' + move.promotion.toUpperCase();
  }

  // Check/checkmate detection requires computing status
  const { newState } = makeMove(state, move);
  const status = getGameStatus(
    newState.board,
    newState.turn,
    newState.kingsPosition[newState.turn],
    newState.castlingRights,
    newState.enPassantSquare,
    newState.halfMoveClock,
    []
  );

  if (status.type === 'checkmate') notation += '#';
  else if (status.type === 'check') notation += '+';

  return notation;
}
