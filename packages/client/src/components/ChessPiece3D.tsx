import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ChessPiece3DProps {
  pieceType: string; // 'k','q','r','b','n','p'
  color: 'w' | 'b';
  position: [number, number, number];
  isSelected?: boolean;
  isCheck?: boolean;
  onClick?: () => void;
  animatedY?: number;
  opacity?: number;
  visible?: boolean;
}

// Highly detailed 2D profile points for each piece (x, y) revolved around Y-axis
// Designed to closely resemble classic Staunton chess pieces
function getPieceProfile(type: string): THREE.Vector2[] {
  const pts: [number, number][] = [];

  switch (type) {
    case 'p': // Pawn — round head on a tapered stem with wide base
      pts.push(
        [0, 0],
        [0.30, 0], [0.32, 0.01], [0.33, 0.03], [0.33, 0.05], [0.32, 0.07],
        // Base flare
        [0.28, 0.08], [0.24, 0.10],
        // Stem taper
        [0.16, 0.16], [0.14, 0.22], [0.13, 0.28],
        // Collar
        [0.16, 0.30], [0.17, 0.32], [0.16, 0.34],
        // Sphere head (approximate with points)
        [0.13, 0.36], [0.17, 0.40], [0.19, 0.44], [0.20, 0.48],
        [0.19, 0.52], [0.17, 0.55], [0.14, 0.58], [0.10, 0.60],
        [0.05, 0.61], [0, 0.62],
      );
      break;

    case 'r': // Rook — battlements (crenellations) on top, stocky
      pts.push(
        [0, 0],
        [0.32, 0], [0.34, 0.01], [0.35, 0.04], [0.35, 0.06], [0.33, 0.08],
        // Base
        [0.28, 0.09], [0.24, 0.11],
        // Tower body — slightly tapered
        [0.22, 0.16], [0.21, 0.30], [0.20, 0.42],
        // Rim flare
        [0.23, 0.44], [0.26, 0.46], [0.27, 0.48],
        // Crenellation (teeth pattern)
        [0.27, 0.56], [0.22, 0.56], [0.22, 0.52],
        [0.17, 0.52], [0.17, 0.58],
        [0.10, 0.58], [0.10, 0.54],
        [0.05, 0.54], [0.05, 0.58],
        [0, 0.58],
      );
      break;

    case 'n': // Knight — taller, distinctive head shape (best approximation for lathe)
      pts.push(
        [0, 0],
        [0.32, 0], [0.34, 0.01], [0.35, 0.04], [0.35, 0.06], [0.33, 0.08],
        // Base
        [0.28, 0.09], [0.24, 0.11],
        // Stem
        [0.17, 0.18], [0.15, 0.28], [0.14, 0.36],
        // Collar
        [0.16, 0.38], [0.17, 0.40], [0.16, 0.42],
        // Head — ear/mane bulge
        [0.13, 0.44], [0.18, 0.50], [0.21, 0.56], [0.22, 0.62],
        // Snout curve
        [0.20, 0.68], [0.16, 0.73], [0.12, 0.76],
        // Ear tip
        [0.14, 0.80], [0.12, 0.84],
        [0.06, 0.86], [0, 0.87],
      );
      break;

    case 'b': // Bishop — slender body, mitre (pointed hat) with a notch
      pts.push(
        [0, 0],
        [0.31, 0], [0.33, 0.01], [0.34, 0.04], [0.34, 0.06], [0.32, 0.08],
        // Base
        [0.27, 0.09], [0.23, 0.11],
        // Stem — slender
        [0.16, 0.18], [0.14, 0.28], [0.13, 0.38],
        // Collar
        [0.15, 0.40], [0.16, 0.42], [0.15, 0.44],
        // Mitre body — smooth ogive curve
        [0.12, 0.48], [0.14, 0.54], [0.15, 0.60], [0.14, 0.66],
        [0.12, 0.72], [0.09, 0.78],
        // Notch/slit (slight indent)
        [0.07, 0.80], [0.08, 0.82],
        // Point
        [0.06, 0.86], [0.03, 0.90],
        // Finial ball
        [0.04, 0.92], [0.05, 0.94], [0.04, 0.96], [0.02, 0.97],
        [0, 0.98],
      );
      break;

    case 'q': // Queen — tall, ornate, crown with ball finial
      pts.push(
        [0, 0],
        [0.34, 0], [0.36, 0.01], [0.37, 0.04], [0.37, 0.07], [0.35, 0.09],
        // Base flare
        [0.30, 0.10], [0.26, 0.12],
        // Body — elegant taper
        [0.20, 0.20], [0.18, 0.32], [0.16, 0.44],
        // Waist
        [0.15, 0.50],
        // Collar
        [0.17, 0.52], [0.18, 0.54], [0.17, 0.56],
        // Crown flare
        [0.14, 0.60], [0.18, 0.66], [0.21, 0.72], [0.22, 0.76],
        // Crown scallops
        [0.20, 0.80], [0.16, 0.82], [0.19, 0.85], [0.16, 0.88],
        [0.12, 0.90],
        // Finial stem
        [0.04, 0.92],
        // Finial ball
        [0.06, 0.94], [0.07, 0.96], [0.06, 0.99], [0.04, 1.01],
        [0.02, 1.02], [0, 1.03],
      );
      break;

    case 'k': // King — tallest, cross on top, dignified crown
      pts.push(
        [0, 0],
        [0.35, 0], [0.37, 0.01], [0.38, 0.04], [0.38, 0.07], [0.36, 0.09],
        // Base flare
        [0.30, 0.10], [0.26, 0.12],
        // Body — gentle taper
        [0.20, 0.20], [0.18, 0.34], [0.16, 0.46],
        // Waist
        [0.15, 0.52],
        // Collar band
        [0.18, 0.54], [0.19, 0.56], [0.18, 0.58], [0.17, 0.60],
        // Crown body
        [0.14, 0.64], [0.18, 0.70], [0.20, 0.76],
        // Crown rim
        [0.22, 0.78], [0.22, 0.80], [0.18, 0.82],
        // Taper to cross stem
        [0.12, 0.86], [0.06, 0.90],
        // Cross — vertical bar
        [0.04, 0.90], [0.04, 0.98],
        // Cross — horizontal bar
        [0.10, 0.98], [0.10, 1.02], [0.04, 1.02],
        // Cross — top
        [0.04, 1.10],
        [0, 1.10],
      );
      break;

    default:
      pts.push([0, 0], [0.2, 0], [0.2, 0.5], [0, 0.5]);
  }

  return pts.map(([x, y]) => new THREE.Vector2(x, y));
}

const PIECE_SCALE: Record<string, number> = {
  p: 1.0, r: 1.0, n: 1.0, b: 1.0, q: 1.0, k: 1.0,
};

const WHITE_COLOR = new THREE.Color(0xfaf5eb);
const BLACK_COLOR = new THREE.Color(0x222222);
const WHITE_EMISSIVE = new THREE.Color(0x1a1810);
const BLACK_EMISSIVE = new THREE.Color(0x050505);
const SELECTED_EMISSIVE_W = new THREE.Color(0x22cc66);
const SELECTED_EMISSIVE_B = new THREE.Color(0x22cc66);
const CHECK_EMISSIVE = new THREE.Color(0xff2222);

export const ChessPiece3D = React.memo(function ChessPiece3D({
  pieceType,
  color,
  position,
  isSelected = false,
  isCheck = false,
  onClick,
  animatedY = 0,
  opacity = 1,
  visible = true,
}: ChessPiece3DProps) {
  const meshRef = useRef<THREE.Group>(null!);
  const glowRef = useRef<THREE.Mesh>(null!);

  const geometry = useMemo(() => {
    const profile = getPieceProfile(pieceType);
    const geo = new THREE.LatheGeometry(profile, 32);
    geo.computeVertexNormals();
    return geo;
  }, [pieceType]);

  // Special memoized geometries for the Knight (horse)
  const knightGeometries = useMemo(() => {
    if (pieceType !== 'n') return null;

    // 1. Knight round base geometry
    const baseProfile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.32, 0),
      new THREE.Vector2(0.34, 0.01),
      new THREE.Vector2(0.35, 0.04),
      new THREE.Vector2(0.35, 0.06),
      new THREE.Vector2(0.33, 0.08),
      new THREE.Vector2(0.28, 0.09),
      new THREE.Vector2(0.24, 0.11),
      new THREE.Vector2(0.17, 0.18),
      new THREE.Vector2(0.15, 0.28),
      new THREE.Vector2(0.14, 0.36),
      new THREE.Vector2(0.16, 0.38),
      new THREE.Vector2(0, 0.38),
    ];
    const baseGeo = new THREE.LatheGeometry(baseProfile, 32);
    baseGeo.computeVertexNormals();

    // 2. Knight horse head geometry
    const horseShape = new THREE.Shape();
    horseShape.moveTo(0.15, 0.38);
    // Mane and back of neck
    horseShape.quadraticCurveTo(0.20, 0.55, 0.15, 0.72);
    // Ear back
    horseShape.lineTo(0.17, 0.84);
    // Ear tip
    horseShape.lineTo(0.12, 0.86);
    // Forehead / brow
    horseShape.lineTo(0.08, 0.78);
    // Nose/face slope
    horseShape.quadraticCurveTo(-0.04, 0.74, -0.18, 0.65);
    // Snout / mouth
    horseShape.quadraticCurveTo(-0.25, 0.60, -0.21, 0.52);
    // Muzzle under
    horseShape.quadraticCurveTo(-0.14, 0.46, -0.11, 0.50);
    // Jaw / neck front
    horseShape.quadraticCurveTo(-0.13, 0.43, -0.15, 0.38);
    // Bottom connecting line
    horseShape.lineTo(0.15, 0.38);

    const extrudeSettings = {
      depth: 0.16,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.015,
      bevelThickness: 0.015,
    };
    const headGeo = new THREE.ExtrudeGeometry(horseShape, extrudeSettings);
    headGeo.computeVertexNormals();

    return { baseGeo, headGeo };
  }, [pieceType]);

  const scale = PIECE_SCALE[pieceType] || 1;
  const isWhite = color === 'w';

  // Animate the piece
  useFrame((state) => {
    if (!meshRef.current) return;

    // Subtle idle bob
    const idleBob = Math.sin(state.clock.elapsedTime * 1.2 + position[0] * 3 + position[2] * 5) * 0.005;
    meshRef.current.position.y = position[1] + animatedY + idleBob;

    // Selection glow pulse
    if (glowRef.current) {
      if (isSelected) {
        const pulse = 0.5 + Math.sin(state.clock.elapsedTime * 3.5) * 0.3;
        glowRef.current.visible = true;
        (glowRef.current.material as THREE.MeshBasicMaterial).opacity = pulse * 0.5;
        const glowScale = 1 + Math.sin(state.clock.elapsedTime * 2.5) * 0.04;
        glowRef.current.scale.setScalar(glowScale);
      } else if (isCheck) {
        const pulse = 0.4 + Math.sin(state.clock.elapsedTime * 5) * 0.4;
        glowRef.current.visible = true;
        (glowRef.current.material as THREE.MeshBasicMaterial).opacity = pulse * 0.6;
      } else {
        glowRef.current.visible = false;
      }
    }
  });

  if (!visible) return null;

  const emissiveColor = isCheck
    ? CHECK_EMISSIVE
    : isSelected
      ? (isWhite ? SELECTED_EMISSIVE_W : SELECTED_EMISSIVE_B)
      : (isWhite ? WHITE_EMISSIVE : BLACK_EMISSIVE);

  const emissiveIntensity = isCheck ? 1.0 : isSelected ? 0.5 : 0.05;

  return (
    <group position={[position[0], position[1] + animatedY, position[2]]}>
      {/* The piece container (animated) */}
      <group
        ref={meshRef}
        scale={[scale, scale, scale]}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
      >
        {pieceType === 'n' && knightGeometries ? (
          <>
            <mesh
              geometry={knightGeometries.baseGeo}
              castShadow
              receiveShadow
            >
              <meshStandardMaterial
                color={isWhite ? WHITE_COLOR : BLACK_COLOR}
                emissive={emissiveColor}
                emissiveIntensity={emissiveIntensity}
                metalness={isWhite ? 0.08 : 0.35}
                roughness={isWhite ? 0.4 : 0.2}
                transparent={opacity < 1}
                opacity={opacity}
                envMapIntensity={0.6}
              />
            </mesh>
            <mesh
              geometry={knightGeometries.headGeo}
              position={[0, 0, -0.095]}
              castShadow
              receiveShadow
            >
              <meshStandardMaterial
                color={isWhite ? WHITE_COLOR : BLACK_COLOR}
                emissive={emissiveColor}
                emissiveIntensity={emissiveIntensity}
                metalness={isWhite ? 0.08 : 0.35}
                roughness={isWhite ? 0.4 : 0.2}
                transparent={opacity < 1}
                opacity={opacity}
                envMapIntensity={0.6}
              />
            </mesh>
          </>
        ) : (
          <mesh
            geometry={geometry}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color={isWhite ? WHITE_COLOR : BLACK_COLOR}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
              metalness={isWhite ? 0.08 : 0.35}
              roughness={isWhite ? 0.4 : 0.2}
              transparent={opacity < 1}
              opacity={opacity}
              envMapIntensity={0.6}
            />
          </mesh>
        )}
      </group>

      {/* Selection / check glow ring at base */}
      <mesh
        ref={glowRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        visible={isSelected || isCheck}
      >
        <ringGeometry args={[0.28, 0.46, 32]} />
        <meshBasicMaterial
          color={isCheck ? 0xff3333 : 0x44ffaa}
          transparent
          opacity={0.4}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
});
