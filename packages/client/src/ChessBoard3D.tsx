import { useMemo, useState, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

interface ChessBoard3DProps {
  fen: string;
  selectedSquare: number | null;
  legalTargets: { to: number; promotion: string | null }[];
  lastMove: { from: number; to: number } | null;
  playerColor: 'w' | 'b';
  onSquareClick: (square: number) => void;
  isFlipped: boolean;
}

// Map 0-63 to 3D X/Z coordinates
function squareToCoords(square: number, isFlipped: boolean): [number, number] {
  const file = square % 8;
  const rank = Math.floor(square / 8);
  const displayFile = isFlipped ? 7 - file : file;
  const displayRank = isFlipped ? rank : 7 - rank;
  return [displayFile - 3.5, displayRank - 3.5];
}

// Convert FEN board representation into array of pieces
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

interface PieceState {
  id: string; // unique key to prevent React recycle errors
  type: string;
  square: number;
  isCaptured: boolean;
}

// Procedural Low-Poly Chess Piece Models
interface PieceMeshProps {
  type: string;
  color: 'w' | 'b';
}

function PieceMesh({ type, color }: PieceMeshProps) {
  const lowerType = type.toLowerCase();
  const isWhite = color === 'w';

  // Harmonious, premium materials
  const materialProps = {
    roughness: isWhite ? 0.15 : 0.25,
    metalness: isWhite ? 0.8 : 0.2,
    color: isWhite ? '#e0e0e8' : '#1a1a24',
    emissive: isWhite ? '#11111a' : '#000000',
  };

  if (lowerType === 'p') {
    // Pawn: Cylinder base + stem + sphere top
    return (
      <group>
        <mesh castShadow receiveShadow position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.22, 0.26, 0.1, 12]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.22, 0]}>
          <cylinderGeometry args={[0.13, 0.18, 0.25, 12]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.38, 0]}>
          <sphereGeometry args={[0.16, 12, 12]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      </group>
    );
  }

  if (lowerType === 'r') {
    // Rook: Cylinder base + cylindrical crenellated body
    return (
      <group>
        <mesh castShadow receiveShadow position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.26, 0.3, 0.12, 12]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.28, 0]}>
          <cylinderGeometry args={[0.22, 0.25, 0.35, 12]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.27, 0.24, 0.12, 12]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      </group>
    );
  }

  if (lowerType === 'n') {
    // Knight: Cylindrical base + L-shaped curved head mesh
    return (
      <group>
        <mesh castShadow receiveShadow position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.26, 0.3, 0.12, 12]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        {/* Neck */}
        <mesh castShadow receiveShadow position={[0, 0.28, -0.05]} rotation={[0.2, 0, 0]}>
          <cylinderGeometry args={[0.13, 0.18, 0.34, 12]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        {/* Head snout */}
        <mesh castShadow receiveShadow position={[0, 0.44, 0.05]} rotation={[-0.1, 0, 0]}>
          <boxGeometry args={[0.2, 0.22, 0.32]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      </group>
    );
  }

  if (lowerType === 'b') {
    // Bishop: Cylinder base + tall body + teardrop cone top
    return (
      <group>
        <mesh castShadow receiveShadow position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.26, 0.3, 0.12, 12]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.14, 0.2, 0.4, 12]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.56, 0]}>
          <coneGeometry args={[0.18, 0.3, 12]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.72, 0]}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      </group>
    );
  }

  if (lowerType === 'q') {
    // Queen: Thick base + tall flared body + crown top
    return (
      <group>
        <mesh castShadow receiveShadow position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.28, 0.33, 0.12, 14]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.16, 0.24, 0.5, 14]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.65, 0]}>
          <cylinderGeometry args={[0.26, 0.18, 0.15, 14]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.76, 0]}>
          <sphereGeometry args={[0.07, 10, 10]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      </group>
    );
  }

  if (lowerType === 'k') {
    // King: Thick base + tallest flared body + flared top crown + cross indicator
    return (
      <group>
        <mesh castShadow receiveShadow position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.3, 0.35, 0.12, 14]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.4, 0]}>
          <cylinderGeometry args={[0.18, 0.26, 0.6, 14]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.74, 0]}>
          <cylinderGeometry args={[0.28, 0.2, 0.15, 14]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        {/* Crown Cross */}
        <mesh castShadow receiveShadow position={[0, 0.86, 0]}>
          <boxGeometry args={[0.07, 0.16, 0.07]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
        <mesh castShadow receiveShadow position={[0, 0.89, 0]}>
          <boxGeometry args={[0.16, 0.07, 0.07]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      </group>
    );
  }

  return null;
}

// 3D Animating Chess Piece Instance
interface Piece3DInstanceProps {
  id: string;
  type: string;
  square: number;
  isCaptured: boolean;
  isFlipped: boolean;
  onRemove: (id: string) => void;
}

function Piece3DInstance({ id, type, square, isCaptured, isFlipped, onRemove }: Piece3DInstanceProps) {
  const meshRef = useRef<THREE.Group>(null);
  const color = type === type.toUpperCase() ? 'w' : 'b';

  const targetCoords = useMemo(() => squareToCoords(square, isFlipped), [square, isFlipped]);
  const targetPos = useMemo(() => new THREE.Vector3(targetCoords[0], 0, targetCoords[1]), [targetCoords]);

  const prevSquare = useRef(square);
  const startPos = useRef(new THREE.Vector3(targetCoords[0], 0, targetCoords[1]));
  const progress = useRef(1);

  // Capture effect state
  const isCaptureAnim = useRef(isCaptured);
  const captureProgress = useRef(0);

  useEffect(() => {
    if (square !== prevSquare.current) {
      const oldCoords = squareToCoords(prevSquare.current, isFlipped);
      startPos.current.set(oldCoords[0], 0, oldCoords[1]);
      progress.current = 0;
      prevSquare.current = square;
    }
  }, [square, isFlipped]);

  useEffect(() => {
    if (isCaptured) {
      isCaptureAnim.current = true;
      captureProgress.current = 0;
    }
  }, [isCaptured]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    if (isCaptureAnim.current) {
      // Capture animation: spin, float up, scale to 0, dissolve
      captureProgress.current = Math.min(captureProgress.current + delta * 3, 1);
      
      const scale = 1 - captureProgress.current;
      const yOffset = captureProgress.current * 0.8;
      
      meshRef.current.scale.set(scale, scale, scale);
      meshRef.current.position.y = yOffset;
      meshRef.current.rotation.y += delta * 12;

      if (captureProgress.current >= 1) {
        onRemove(id);
      }
      return;
    }

    if (progress.current < 1) {
      progress.current = Math.min(progress.current + delta * 3.5, 1); // Jump speed
      
      // Arc / jump path interpolation
      const x = THREE.MathUtils.lerp(startPos.current.x, targetPos.x, progress.current);
      const z = THREE.MathUtils.lerp(startPos.current.z, targetPos.z, progress.current);
      const y = Math.sin(progress.current * Math.PI) * 0.75; // Arch peak height

      meshRef.current.position.set(x, y, z);
      
      // Face knight snout to target movement direction
      if (type.toLowerCase() === 'n' && startPos.current.distanceTo(targetPos) > 0.1) {
        const dir = new THREE.Vector3().subVectors(targetPos, startPos.current).normalize();
        const angle = Math.atan2(dir.x, dir.z);
        meshRef.current.rotation.y = angle;
      }
    } else {
      meshRef.current.position.copy(targetPos);
      if (type.toLowerCase() === 'n') {
        meshRef.current.rotation.y = isFlipped ? Math.PI : 0;
      }
    }
  });

  return (
    <group ref={meshRef} rotation={[0, type.toLowerCase() === 'n' && isFlipped ? Math.PI : 0, 0]}>
      <PieceMesh type={type} color={color} />
    </group>
  );
}

export function ChessBoard3D({
  fen,
  selectedSquare,
  legalTargets,
  lastMove,
  playerColor,
  onSquareClick,
  isFlipped,
}: ChessBoard3DProps) {
  const board = useMemo(() => parseFenBoard(fen), [fen]);
  const legalTargetSet = useMemo(() => new Set(legalTargets.map((t) => t.to)), [legalTargets]);

  const [pieces, setPieces] = useState<PieceState[]>([]);

  // Synchronize internal pieces state with the incoming board FEN
  useEffect(() => {
    setPieces((prevPieces) => {
      const currentPiecesMap = new Map<number, string>(); // square -> type
      board.forEach((piece, index) => {
        if (piece) currentPiecesMap.set(index, piece);
      });

      const nextPieces: PieceState[] = [];

      // 1. Check existing pieces
      prevPieces.forEach((p) => {
        if (p.isCaptured) {
          nextPieces.push(p); // Keep rendering dying pieces
          return;
        }

        const currentPieceOnSquare = currentPiecesMap.get(p.square);
        if (currentPieceOnSquare === p.type) {
          // Piece stayed at its square
          nextPieces.push(p);
          currentPiecesMap.delete(p.square);
        } else {
          // Piece either moved or was captured
          const movedToSquare = [...currentPiecesMap.entries()].find(
            ([sq, type]) => type === p.type && !prevPieces.some((pp) => pp.square === sq && pp.type === type)
          );

          if (movedToSquare) {
            // It moved! Update square position
            nextPieces.push({ ...p, square: movedToSquare[0] });
            currentPiecesMap.delete(movedToSquare[0]);
          } else {
            // It was captured! Transition to dying state
            nextPieces.push({ ...p, isCaptured: true });
          }
        }
      });

      // 2. Add any newly spawned pieces
      currentPiecesMap.forEach((type, square) => {
        nextPieces.push({
          id: `${type}-${square}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          type,
          square,
          isCaptured: false,
        });
      });

      return nextPieces;
    });
  }, [board]);

  const handleRemovePiece = (id: string) => {
    setPieces((prev) => prev.filter((p) => p.id !== id));
  };

  // 3D Grid Squares Configuration
  const squares = useMemo(() => {
    const list = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const displayRank = isFlipped ? row : 7 - row;
        const displayFile = isFlipped ? 7 - col : col;
        const sq = displayRank * 8 + displayFile;
        const isLight = (row + col) % 2 === 0;

        const isSelected = sq === selectedSquare;
        const isLegalTarget = legalTargetSet.has(sq);
        const hasPiece = board[sq] !== null;
        const isLegalCapture = isLegalTarget && hasPiece;
        const isLastMove = lastMove !== null && (sq === lastMove.from || sq === lastMove.to);

        list.push({
          sq,
          isLight,
          isSelected,
          isLegalTarget,
          isLegalCapture,
          isLastMove,
          x: col - 3.5,
          z: row - 3.5,
        });
      }
    }
    return list;
  }, [board, selectedSquare, legalTargetSet, lastMove, isFlipped]);

  return (
    <div className="board-3d-wrapper" style={{ width: '100%', height: '100%', minHeight: '600px', position: 'relative' }}>
      <Canvas shadows camera={{ position: [0, 6.5, 7.5], fov: 48 }}>
        <ambientLight intensity={0.55} />
        {/* Premium Warm Lighting */}
        <pointLight position={[-10, 15, -10]} intensity={0.3} />
        <directionalLight
          position={[6, 11, 4]}
          intensity={0.8}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-far={20}
          shadow-camera-left={-5}
          shadow-camera-right={5}
          shadow-camera-top={5}
          shadow-camera-bottom={-5}
        />

        {/* 3D Board Mesh Rendering */}
        <group receiveShadow castShadow position={[0, -0.05, 0]}>
          {squares.map(({ sq, isLight, isSelected, isLegalTarget, isLegalCapture, isLastMove, x, z }) => {
            // Colors matching our beautiful theme
            let tileColor = isLight ? '#eaeadd' : '#4d5c7c';
            let emissiveColor = '#000000';

            if (isSelected) {
              tileColor = '#ffd54f';
              emissiveColor = '#ffd54f';
            } else if (isLegalCapture) {
              tileColor = '#e57373';
              emissiveColor = '#b71c1c';
            } else if (isLegalTarget) {
              tileColor = '#81c784';
              emissiveColor = '#1b5e20';
            } else if (isLastMove) {
              tileColor = '#64b5f6';
              emissiveColor = '#0d47a1';
            }

            return (
              <mesh
                key={sq}
                position={[x, 0, z]}
                receiveShadow
                onClick={(e) => {
                  e.stopPropagation();
                  onSquareClick(sq);
                }}
              >
                <boxGeometry args={[0.96, 0.1, 0.96]} />
                <meshStandardMaterial
                  color={tileColor}
                  roughness={0.4}
                  metalness={0.1}
                  emissive={emissiveColor}
                  emissiveIntensity={isSelected || isLegalTarget || isLastMove ? 0.35 : 0}
                />
              </mesh>
            );
          })}
          
          {/* Wood board frame border */}
          <mesh position={[0, -0.06, 0]} receiveShadow>
            <boxGeometry args={[8.4, 0.11, 8.4]} />
            <meshStandardMaterial color="#2d221c" roughness={0.7} metalness={0.15} />
          </mesh>
        </group>

        {/* Render chess piece instances */}
        {pieces.map((p) => (
          <Piece3DInstance
            key={p.id}
            id={p.id}
            type={p.type}
            square={p.square}
            isCaptured={p.isCaptured}
            isFlipped={isFlipped}
            onRemove={handleRemovePiece}
          />
        ))}

        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          maxPolarAngle={Math.PI / 2 - 0.05} // don't go under board
          minDistance={3.5}
          maxDistance={12}
        />
      </Canvas>

      {/* Control Overlay Hint */}
      <div
        style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          background: 'rgba(10, 10, 26, 0.75)',
          color: '#8b9bb4',
          padding: '6px 12px',
          borderRadius: '4px',
          fontSize: '0.8rem',
          pointerEvents: 'none',
          border: '1px solid #2a2a4a',
        }}
      >
        🖱️ Right-click / Drag to rotate | 📜 Scroll to zoom
      </div>
    </div>
  );
}
