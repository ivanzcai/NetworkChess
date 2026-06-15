import { useMemo } from 'react';

interface ChessBoardProps {
  fen: string;
  selectedSquare: number | null;
  legalTargets: { to: number; promotion: string | null }[];
  lastMove: { from: number; to: number } | null;
  playerColor: 'w' | 'b';
  onSquareClick: (square: number) => void;
  isFlipped: boolean;
}

const PIECE_UNICODE: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

function parseFenBoard(fen: string): (string | null)[] {
  const board: (string | null)[] = new Array(64).fill(null);
  const parts = fen.split(' ');
  const ranks = parts[0].split('/');

  if (ranks.length !== 8) return board;

  for (let rank = 0; rank < 8; rank++) {
    const rankStr = ranks[7 - rank]; // FEN goes from rank 8 to 1
    let file = 0;
    for (const char of rankStr) {
      if (char >= '1' && char <= '8') {
        file += parseInt(char);
      } else {
        board[rank * 8 + file] = char;
        file++;
      }
    }
  }

  return board;
}

export function ChessBoard({
  fen,
  selectedSquare,
  legalTargets,
  lastMove,
  playerColor,
  onSquareClick,
  isFlipped,
}: ChessBoardProps) {
  const board = useMemo(() => parseFenBoard(fen), [fen]);

  const legalTargetSet = useMemo(
    () => new Set(legalTargets.map((t) => t.to)),
    [legalTargets]
  );

  const squares: React.ReactNode[] = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const displayRank = isFlipped ? row : 7 - row;
      const displayFile = isFlipped ? 7 - col : col;
      const sq = displayRank * 8 + displayFile;
      const isLight = (row + col) % 2 === 0;
      const piece = board[sq];

      const isSelected = sq === selectedSquare;
      const isLegalTarget = legalTargetSet.has(sq);
      const isLegalCapture = isLegalTarget && piece !== null;
      const isLastMove =
        lastMove !== null && (sq === lastMove.from || sq === lastMove.to);

      let className = 'square';
      className += isLight ? ' light' : ' dark';
      if (isSelected) className += ' selected';
      if (isLastMove) className += ' last-move';
      if (isLegalTarget && !piece) className += ' legal-move';
      if (isLegalCapture) className += ' legal-capture';

      squares.push(
        <div
          key={sq}
          className={className}
          onClick={() => onSquareClick(sq)}
        >
          {piece && (
            <span className={`piece ${piece === piece.toUpperCase() ? 'white' : 'black'}`}>
              {PIECE_UNICODE[piece] || '?'}
            </span>
          )}
        </div>
      );
    }
  }

  return <div className="board">{squares}</div>;
}
