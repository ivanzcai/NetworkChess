import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';

interface Board3DProps {
  selectedSquare: number | null;
  legalTargets: Set<number>;
  lastMove: { from: number; to: number } | null;
  isFlipped: boolean;
  onSquareClick: (square: number) => void;
  occupiedSquares?: Set<number>;
}

// Board dimensions
const SQUARE_SIZE = 1;
const BOARD_SIZE = 8 * SQUARE_SIZE;
const BOARD_Y = 0;

// Board square colors — SkyMate Airy Theme
const LIGHT_SQUARE = new THREE.Color(0xffffff);  // Cloud white
const DARK_SQUARE = new THREE.Color(0xbae6fd);    // Sky blue
const SELECTED_LIGHT = new THREE.Color(0xfef08a); // Sunny yellow
const SELECTED_DARK = new THREE.Color(0xfde047);
const LAST_MOVE_LIGHT = new THREE.Color(0xfebd8a); // Soft peach
const LAST_MOVE_DARK = new THREE.Color(0xfd9b47);
const BORDER_COLOR = new THREE.Color(0xd2c6b4);   // Light birch/maple border

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

export function squareTo3DPosition(square: number, isFlipped: boolean): [number, number, number] {
  const file = square % 8;
  const rank = Math.floor(square / 8);
  let x: number, z: number;

  if (isFlipped) {
    x = (7 - file) * SQUARE_SIZE - BOARD_SIZE / 2 + SQUARE_SIZE / 2;
    z = -((7 - rank) * SQUARE_SIZE - BOARD_SIZE / 2 + SQUARE_SIZE / 2);
  } else {
    x = file * SQUARE_SIZE - BOARD_SIZE / 2 + SQUARE_SIZE / 2;
    z = -(rank * SQUARE_SIZE - BOARD_SIZE / 2 + SQUARE_SIZE / 2);
  }

  return [x, BOARD_Y + 0.02, z];
}

// Individual square
const BoardSquare = React.memo(function BoardSquare({
  square,
  isLight,
  isSelected,
  isLegalTarget,
  isLastMove,
  hasPiece,
  position,
  onClick,
}: {
  square: number;
  isLight: boolean;
  isSelected: boolean;
  isLegalTarget: boolean;
  isLastMove: boolean;
  hasPiece: boolean;
  position: [number, number, number];
  onClick: () => void;
}) {
  const color = useMemo(() => {
    if (isSelected) return isLight ? SELECTED_LIGHT : SELECTED_DARK;
    if (isLastMove) return isLight ? LAST_MOVE_LIGHT : LAST_MOVE_DARK;
    return isLight ? LIGHT_SQUARE : DARK_SQUARE;
  }, [isLight, isSelected, isLastMove]);

  return (
    <group>
      {/* Square tile — 3D box raised from the base */}
      <mesh
        position={[position[0], BOARD_Y + 0.01, position[2]]}
        receiveShadow
        castShadow
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        <boxGeometry args={[SQUARE_SIZE - 0.02, 0.02, SQUARE_SIZE - 0.02]} />
        <meshStandardMaterial
          color={color}
          roughness={isLight ? 0.6 : 0.5}
          metalness={0.05}
        />
      </mesh>

      {/* Legal move dot */}
      {isLegalTarget && !hasPiece && (
        <mesh position={[position[0], BOARD_Y + 0.04, position[2]]}>
          <cylinderGeometry args={[0.13, 0.13, 0.02, 20]} />
          <meshStandardMaterial
            color={0x000000}
            transparent
            opacity={0.3}
            roughness={1}
          />
        </mesh>
      )}

      {/* Legal capture ring */}
      {isLegalTarget && hasPiece && (
        <mesh
          position={[position[0], BOARD_Y + 0.021, position[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.36, 0.48, 32]} />
          <meshStandardMaterial
            color={0xee3333}
            transparent
            opacity={0.5}
            roughness={0.3}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
});

export const Board3D = React.memo(function Board3D({
  selectedSquare,
  legalTargets,
  lastMove,
  isFlipped,
  onSquareClick,
  occupiedSquares,
}: Board3DProps) {
  const squares = useMemo(() => {
    const result: {
      square: number;
      isLight: boolean;
      position: [number, number, number];
    }[] = [];

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const sq = rank * 8 + file;
        const isLight = (rank + file) % 2 !== 0;
        const pos = squareTo3DPosition(sq, isFlipped);
        result.push({ square: sq, isLight, position: pos });
      }
    }
    return result;
  }, [isFlipped]);

  const labelPositions = useMemo(() => {
    const labels: { text: string; position: [number, number, number] }[] = [];
    const labelOffset = BOARD_SIZE / 2 + 0.20;

    for (let i = 0; i < 8; i++) {
      const fileIdx = isFlipped ? 7 - i : i;
      const rankIdx = isFlipped ? 7 - i : i;

      // File labels (a-h) along the front edge
      labels.push({
        text: FILES[fileIdx],
        position: [
          i * SQUARE_SIZE - BOARD_SIZE / 2 + SQUARE_SIZE / 2,
          BOARD_Y + 0.01,
          labelOffset,
        ],
      });

      // Rank labels (1-8) along the left edge
      labels.push({
        text: RANKS[rankIdx],
        position: [
          -labelOffset,
          BOARD_Y + 0.01,
          -(i * SQUARE_SIZE - BOARD_SIZE / 2 + SQUARE_SIZE / 2),
        ],
      });
    }
    return labels;
  }, [isFlipped]);

  const occupiedSet = occupiedSquares || new Set<number>();

  return (
    <group>
      {/* Board base — flat slab beneath the squares */}
      <mesh position={[0, BOARD_Y - 0.08, 0]} receiveShadow castShadow>
        <boxGeometry args={[BOARD_SIZE + 0.8, 0.16, BOARD_SIZE + 0.8]} />
        <meshStandardMaterial
          color={BORDER_COLOR}
          roughness={0.35}
          metalness={0.15}
        />
      </mesh>

      {/* Squares */}
      {squares.map(({ square, isLight, position }) => (
        <BoardSquare
          key={square}
          square={square}
          isLight={isLight}
          isSelected={square === selectedSquare}
          isLegalTarget={legalTargets.has(square)}
          isLastMove={lastMove !== null && (square === lastMove.from || square === lastMove.to)}
          hasPiece={occupiedSet.has(square)}
          position={position}
          onClick={() => onSquareClick(square)}
        />
      ))}

      {/* Coordinate labels */}
      {labelPositions.map((label, idx) => (
        <Text
          key={idx}
          position={label.position}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.2}
          color="#a08968"
          anchorX="center"
          anchorY="middle"
          font={undefined}
        >
          {label.text}
        </Text>
      ))}
    </group>
  );
});
