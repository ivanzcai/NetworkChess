import { useState, useCallback, useRef } from 'react';


// Represents an in-flight animation
interface MoveAnimation {
  pieceKey: string;       // unique key for the piece being animated
  fromPos: [number, number, number];
  toPos: [number, number, number];
  startTime: number;
  duration: number;
  capturedPieceKey?: string; // key of piece being captured
}

interface AnimationState {
  // Current animated positions (overrides for pieces mid-animation)
  animatedPositions: Map<string, [number, number, number]>;
  // Pieces that are currently fading out (captured)
  fadingPieces: Map<string, { opacity: number; position: [number, number, number] }>;
  // Whether any animation is currently running
  isAnimating: boolean;
}

interface BoardPiece {
  type: string;
  color: 'w' | 'b';
  square: number;
}

// Parse FEN to get piece positions
function parseFenToPieces(fen: string): BoardPiece[] {
  if (!fen) return [];
  const parts = fen.split(' ');
  const ranks = parts[0].split('/');
  const pieces: BoardPiece[] = [];

  if (ranks.length !== 8) return [];

  for (let rank = 0; rank < 8; rank++) {
    const rankStr = ranks[7 - rank]; // FEN goes from rank 8 to 1
    let file = 0;
    for (const char of rankStr) {
      if (char >= '1' && char <= '8') {
        file += parseInt(char);
      } else {
        const color = char === char.toUpperCase() ? 'w' : 'b';
        const type = char.toLowerCase();
        pieces.push({ type, color, square: rank * 8 + file });
        file++;
      }
    }
  }
  return pieces;
}

// Easing function: ease-in-out cubic
function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Calculate arc position at time t (0-1)
function getArcPosition(
  from: [number, number, number],
  to: [number, number, number],
  t: number
): [number, number, number] {
  const eased = easeInOutCubic(t);

  // Horizontal lerp
  const x = from[0] + (to[0] - from[0]) * eased;
  const z = from[2] + (to[2] - from[2]) * eased;

  // Vertical arc: parabola that peaks at t=0.5
  const distance = Math.sqrt(
    Math.pow(to[0] - from[0], 2) + Math.pow(to[2] - from[2], 2)
  );
  const arcHeight = Math.max(0.4, distance * 0.35); // Higher arc for longer moves
  const y = from[1] + 4 * arcHeight * t * (1 - t);

  return [x, y, z];
}

export interface UseChessAnimationsResult {
  // Current state
  animState: AnimationState;
  // Trigger a move animation
  triggerMoveAnimation: (
    pieceKey: string,
    from: [number, number, number],
    to: [number, number, number],
    capturedPieceKey?: string,
    capturedPos?: [number, number, number]
  ) => void;
  // Get current position for a piece (animated or static)
  getPiecePosition: (pieceKey: string, staticPos: [number, number, number]) => [number, number, number];
  // Get opacity for a piece (for fade-out on capture)
  getPieceOpacity: (pieceKey: string) => number;
  // Check if a specific piece is currently being animated
  isPieceAnimating: (pieceKey: string) => boolean;
  // Parse FEN and diff against previous to detect moves
  diffAndAnimate: (
    oldFen: string,
    newFen: string,
    moveInfo: { from: number; to: number } | null,
    squareTo3D: (sq: number) => [number, number, number]
  ) => void;
  // Update animations each frame (call from useFrame)
  updateAnimations: (time: number) => void;
}

export function useChessAnimations(): UseChessAnimationsResult {
  const [animState, setAnimState] = useState<AnimationState>({
    animatedPositions: new Map(),
    fadingPieces: new Map(),
    isAnimating: false,
  });

  const activeAnimations = useRef<MoveAnimation[]>([]);
  const previousFenRef = useRef<string>('');

  const triggerMoveAnimation = useCallback((
    pieceKey: string,
    from: [number, number, number],
    to: [number, number, number],
    capturedPieceKey?: string,
    capturedPos?: [number, number, number]
  ) => {
    const anim: MoveAnimation = {
      pieceKey,
      fromPos: from,
      toPos: to,
      startTime: -1, // Will be set on first frame
      duration: 0.5,
      capturedPieceKey,
    };

    activeAnimations.current.push(anim);
    setAnimState(prev => ({ ...prev, isAnimating: true }));
  }, []);

  const updateAnimations = useCallback((time: number) => {
    if (activeAnimations.current.length === 0) return;

    const newPositions = new Map<string, [number, number, number]>();
    const completedAnims: number[] = [];

    activeAnimations.current.forEach((anim, idx) => {
      // Set start time on first frame
      if (anim.startTime < 0) {
        anim.startTime = time;
      }

      const elapsed = time - anim.startTime;
      const progress = Math.min(elapsed / anim.duration, 1);

      if (progress >= 1) {
        completedAnims.push(idx);
      } else {
        const pos = getArcPosition(anim.fromPos, anim.toPos, progress);
        newPositions.set(anim.pieceKey, pos);
      }
    });

    // Remove completed animations
    for (let i = completedAnims.length - 1; i >= 0; i--) {
      activeAnimations.current.splice(completedAnims[i], 1);
    }

    setAnimState(prev => ({
      animatedPositions: newPositions,
      fadingPieces: new Map(),
      isAnimating: activeAnimations.current.length > 0,
    }));
  }, []);

  const getPiecePosition = useCallback((pieceKey: string, staticPos: [number, number, number]): [number, number, number] => {
    return animState.animatedPositions.get(pieceKey) || staticPos;
  }, [animState.animatedPositions]);

  const getPieceOpacity = useCallback((pieceKey: string): number => {
    return 1;
  }, []);

  const isPieceAnimating = useCallback((pieceKey: string): boolean => {
    return animState.animatedPositions.has(pieceKey);
  }, [animState.animatedPositions]);

  const diffAndAnimate = useCallback((
    oldFen: string,
    newFen: string,
    moveInfo: { from: number; to: number } | null,
    squareTo3D: (sq: number) => [number, number, number]
  ) => {
    if (!oldFen || !newFen || oldFen === newFen || !moveInfo) {
      previousFenRef.current = newFen;
      return;
    }

    const oldPieces = parseFenToPieces(oldFen);

    // Find the piece that moved
    const movedPiece = oldPieces.find(p => p.square === moveInfo.from);
    if (!movedPiece) {
      previousFenRef.current = newFen;
      return;
    }

    // Use the piece's destination key in the new FEN to match rendering key
    const pieceKey = `${movedPiece.color}${movedPiece.type}_${moveInfo.to}`;
    const fromPos = squareTo3D(moveInfo.from);
    const toPos = squareTo3D(moveInfo.to);

    triggerMoveAnimation(pieceKey, fromPos, toPos);

    // Handle castling (detect rook movement)
    if (movedPiece.type === 'k' && Math.abs(moveInfo.from % 8 - moveInfo.to % 8) === 2) {
      const isKingSide = moveInfo.to % 8 > moveInfo.from % 8;
      const rank = Math.floor(moveInfo.from / 8);
      const rookFrom = isKingSide ? rank * 8 + 7 : rank * 8;
      const rookTo = isKingSide ? rank * 8 + 5 : rank * 8 + 3;
      const rookKey = `${movedPiece.color}r_${rookTo}`;
      triggerMoveAnimation(rookKey, squareTo3D(rookFrom), squareTo3D(rookTo));
    }

    previousFenRef.current = newFen;
  }, [triggerMoveAnimation]);

  return {
    animState,
    triggerMoveAnimation,
    getPiecePosition,
    getPieceOpacity,
    isPieceAnimating,
    diffAndAnimate,
    updateAnimations,
  };
}

export { parseFenToPieces };
export type { BoardPiece };
