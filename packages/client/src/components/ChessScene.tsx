import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';

import { Board3D, squareTo3DPosition } from './Board3D.js';
import { ChessPiece3D } from './ChessPiece3D.js';
import { ParticleSystem } from './ParticleSystem.js';
import type { ParticleEffect } from './ParticleSystem.js';
import { useChessAnimations, parseFenToPieces } from '../hooks/useChessAnimations.js';

interface ChessSceneProps {
  fen: string;
  selectedSquare: number | null;
  legalTargets: { to: number; promotion: string | null }[];
  lastMove: { from: number; to: number } | null;
  playerColor: 'w' | 'b';
  onSquareClick: (square: number) => void;
  isFlipped: boolean;
  status?: { type: string; color?: string; winner?: string };
  turn?: 'w' | 'b';
}

// Inner scene component (must be inside Canvas)
function ChessSceneInner({
  fen,
  selectedSquare,
  legalTargets,
  lastMove,
  playerColor,
  onSquareClick,
  isFlipped,
  status,
  turn,
}: ChessSceneProps) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const prevFenRef = useRef(fen);
  const prevMoveRef = useRef(lastMove);
  const [particleEffects, setParticleEffects] = useState<ParticleEffect[]>([]);

  const animations = useChessAnimations();

  // Legal target set for quick lookup
  const legalTargetSet = useMemo(
    () => new Set(legalTargets.map(t => t.to)),
    [legalTargets]
  );

  // Parse board pieces from FEN
  const pieces = useMemo(() => parseFenToPieces(fen), [fen]);

  // Set of occupied squares for board capture indicators
  const occupiedSquares = useMemo(
    () => new Set(pieces.map(p => p.square)),
    [pieces]
  );

  // Helper to convert square to 3D
  const sq3D = useCallback(
    (sq: number): [number, number, number] => squareTo3DPosition(sq, isFlipped),
    [isFlipped]
  );

  // Detect moves and trigger animations
  useEffect(() => {
    if (prevFenRef.current !== fen && lastMove) {
      // Check for capture to trigger particles
      const oldPieces = parseFenToPieces(prevFenRef.current);
      const capturedPiece = oldPieces.find(p => p.square === lastMove.to);

      if (capturedPiece) {
        const pos = sq3D(lastMove.to);
        const effectColor = capturedPiece.color === 'w'
          ? new THREE.Color(0xf5f0e8)
          : new THREE.Color(0x4a3a2a);

        setParticleEffects(prev => [...prev, {
          id: `capture_${Date.now()}`,
          position: [pos[0], pos[1] + 0.3, pos[2]],
          color: effectColor,
          startTime: -1, // Will be set on first frame
          type: 'capture' as const,
        }]);
      }

      // Also check en passant
      const movedPiece = oldPieces.find(p => p.square === lastMove.from);
      if (movedPiece?.type === 'p' && lastMove.from % 8 !== lastMove.to % 8 && !capturedPiece) {
        const epSquare = lastMove.from < lastMove.to ? lastMove.to - 8 : lastMove.to + 8;
        const epPiece = oldPieces.find(p => p.square === epSquare);
        if (epPiece) {
          const pos = sq3D(epSquare);
          setParticleEffects(prev => [...prev, {
            id: `ep_capture_${Date.now()}`,
            position: [pos[0], pos[1] + 0.3, pos[2]],
            color: new THREE.Color(epPiece.color === 'w' ? 0xf5f0e8 : 0x4a3a2a),
            startTime: -1,
            type: 'capture' as const,
          }]);
        }
      }

      animations.diffAndAnimate(prevFenRef.current, fen, lastMove, sq3D);
    }
    prevFenRef.current = fen;
    prevMoveRef.current = lastMove;
  }, [fen, lastMove, animations, sq3D]);

  // Fix particle startTime on first render frame
  useFrame((state) => {
    animations.updateAnimations(state.clock.elapsedTime);

    // Set start times for new particle effects
    setParticleEffects(prev => {
      let changed = false;
      const updated = prev.map(e => {
        if (e.startTime < 0) {
          changed = true;
          return { ...e, startTime: state.clock.elapsedTime };
        }
        return e;
      });
      return changed ? updated : prev;
    });
  });

  // Remove completed particle effects
  const handleEffectComplete = useCallback((id: string) => {
    setParticleEffects(prev => prev.filter(e => e.id !== id));
  }, []);

  // Camera position based on player color
  useEffect(() => {
    // Playable side is always placed on the positive Z side (Z = 3.5) by squareTo3DPosition.
    // So the camera should always face from the positive Z side (Z = 7.5) to look at the player's pieces.
    const targetPos = new THREE.Vector3(0, 7.5, 7.5);

    // Animate camera (swoop in on mount/color change)
    const startPos = camera.position.clone();
    const duration = 1200;
    const startTime = Date.now();

    function animateCamera() {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      camera.position.lerpVectors(startPos, targetPos, eased);
      camera.lookAt(0, 0, 0);

      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
      }

      if (t < 1) requestAnimationFrame(animateCamera);
    }

    animateCamera();
  }, [isFlipped, camera]);

  // Check if king is in check
  const isCheck = status?.type === 'check' || status?.type === 'checkmate';
  const checkColor = status?.color || turn;

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} color={0xfff5e6} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={1.5}
        color={0xfff8f0}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={30}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.001}
      />
      <directionalLight
        position={[-3, 6, -4]}
        intensity={0.3}
        color={0xc4d4ff}
      />
      <pointLight position={[0, 6, 0]} intensity={0.5} color={0xffeedd} distance={15} />

      {/* Background */}
      <fog attach="fog" args={[0xe0f2fe, 15, 35]} />

      {/* Board */}
      <Board3D
        selectedSquare={selectedSquare}
        legalTargets={legalTargetSet}
        lastMove={lastMove}
        isFlipped={isFlipped}
        onSquareClick={onSquareClick}
        occupiedSquares={occupiedSquares}
      />

      {/* Pieces */}
      {pieces.map((piece) => {
        const pos = sq3D(piece.square);
        const key = `${piece.color}${piece.type}_${piece.square}`;
        const isKingInCheck = isCheck && piece.type === 'k' && piece.color === checkColor;
        const animPos = animations.getPiecePosition(key, pos);

        return (
          <ChessPiece3D
            key={key}
            pieceType={piece.type}
            color={piece.color}
            position={animPos}
            isSelected={piece.square === selectedSquare}
            isCheck={isKingInCheck}
            onClick={() => onSquareClick(piece.square)}
            opacity={animations.getPieceOpacity(key)}
          />
        );
      })}

      {/* Particle effects */}
      <ParticleSystem
        effects={particleEffects}
        onEffectComplete={handleEffectComplete}
      />

      {/* Camera controls */}
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        minDistance={5}
        maxDistance={20}
        minPolarAngle={Math.PI * 0.15}
        maxPolarAngle={Math.PI * 0.45}
        enableDamping
        dampingFactor={0.08}
        target={[0, 0, 0]}
      />
    </>
  );
}

// Outer wrapper that provides the Canvas
export function ChessScene(props: ChessSceneProps) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: '500px',
      }}
    >
      <Canvas
        shadows
        camera={{ position: [0, 11, 11], fov: 45, near: 0.1, far: 100 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.5,
        }}
        style={{ background: 'linear-gradient(180deg, #bae6fd 0%, #f0f9ff 100%)' }}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
        }}
      >
        <ChessSceneInner {...props} />
      </Canvas>
    </div>
  );
}
