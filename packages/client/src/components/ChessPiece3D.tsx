import React, { useRef, useMemo, useState } from 'react';
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

// Procedural noise-driven marble bundle for the dark pieces. Each call
// returns three CanvasTextures (diffuse / normal / roughness) that share
// the same underlying lightness field, so the veining lines up across
// maps: the bright "raised" streaks in the diffuse become raised in the
// normal map AND slightly glossier/low-roughness regions.
//
// Recipe (same as before for the diffuse):
//   1. Domain warp: feed fractal noise back into the sin argument so
//      veins get squished/stretched organically (real-marble branching
//      look) rather than running as parallel stripes.
//   2. Sharpen the sin output with pow(.., n) so the veins are THIN and
//      DARK like real marble, not soft sine waves.
//   3. Stack two vein generations (primary + lighter wisps).
//   4. Layer a low-frequency cloud for mineral-density variation.
//   5. Add high-frequency grain so the texture doesn't read as digital.
//   6. Cool tint inside the veins (translucent mineral edge).
//   7. NEW — derive a tangent-space normal map from the lightness field
//      gradient (4-tap finite difference). Raised areas (high lightness)
//      call out as bumps.
//   8. NEW — derive a roughness map where the polished-marble base is
//      lower-roughness and the rougher vein mineral is higher-roughness.
interface MarbleSurfaces {
  diffuse: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
}

function createDarkGreyMarbleSurfaces(size: number, seed: number): MarbleSurfaces {
  // Value noise on a unit grid, bilinearly interpolated; `seed` shifts
  // the hash so each variant produces a different pattern.
  const hash2 = (x: number, y: number) => {
    const s =
      Math.sin((x + seed * 17.1) * 12.9898 + (y + seed * 11.3) * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const smoothNoise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const a = hash2(xi, yi);
    const b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1);
    const d = hash2(xi + 1, yi + 1);
    const ux = xf * xf * (3 - 2 * xf);
    const uy = yf * yf * (3 - 2 * yf);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
  };
  // Fractal Brownian motion: stack octaves of smooth noise. amp *= 0.55
  // and freq *= 2.05 give organic, slightly non-power-of-two scaling
  // (more chaotic-looking than a strict 1/2 falloff).
  const fbm = (x: number, y: number, octaves: number) => {
    let total = 0;
    let amp = 1;
    let freq = 1;
    let max = 0;
    for (let i = 0; i < octaves; i++) {
      total += smoothNoise(x * freq, y * freq) * amp;
      max += amp;
      amp *= 0.55;
      freq *= 2.05;
    }
    return total / max;
  };

  // === Pass 1: compute lightness + cool-tint field per pixel ===
  const lightness = new Float32Array(size * size);
  const hueCool = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;

      // Domain warp.
      const warpX = fbm(nx * 3.0 + 1.7 + seed * 0.31, ny * 3.0 + 0.8, 4);
      const warpY = fbm(nx * 3.0 + 5.2 + seed * 0.73, ny * 3.0 + 7.4, 4);

      // Primary veins (sharp dark strands via pow(sin, 5)).
      const sx = nx + (warpX - 0.5) * 1.6;
      const sy = ny + (warpY - 0.5) * 1.6;
      const primary = Math.sin((sx + sy * 0.85) * Math.PI * 4.0 + (warpX + warpY) * 2.5);
      const primaryVein = Math.pow(Math.max(0, primary), 5);

      // Secondary wisps (lighter weight).
      const sx2 = nx * 4.5 + (warpX - 0.5) * 1.0;
      const sy2 = ny * 4.5 + (warpY - 0.5) * 1.0;
      const secondary = Math.sin((sx2 - sy2 * 0.6) * Math.PI * 2.5);
      const secondaryVein = Math.pow(Math.max(0, secondary), 7) * 0.35;

      // Cloudy mineral-density variation.
      const cloud = fbm(nx * 1.4 + seed * 1.1, ny * 1.4 + seed * 1.3, 3);

      // Fine grain.
      const grain = (fbm(nx * 28, ny * 28, 1) - 0.5) * 0.10;

      // Final lightness.
      const l = Math.max(
        0,
        Math.min(
          1,
          0.56 + (cloud - 0.5) * 0.18 + grain - primaryVein * 0.55 - secondaryVein * 0.22,
        ),
      );
      const idx = y * size + x;
      lightness[idx] = l;
      hueCool[idx] = primaryVein * 0.04 + secondaryVein * 0.02;
    }
  }

  const fillCanvas = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return { canvas, ctx: canvas.getContext('2d')! };
  };

  // === Pass 2: build diffuse canvas (RGB with cool tint inside veins) ===
  const { canvas: diffCanvas, ctx: diffCtx } = fillCanvas(size, size);
  const diffImg = diffCtx.createImageData(size, size);
  const diffData = diffImg.data;
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(lightness[i] * 255);
    const hc = hueCool[i];
    const off = i * 4;
    diffData[off] = Math.max(0, Math.min(255, v));
    diffData[off + 1] = Math.max(0, Math.min(255, v - Math.round(hc * 12)));
    diffData[off + 2] = Math.max(0, Math.min(255, v - Math.round(hc * 30)));
    diffData[off + 3] = 255;
  }
  diffCtx.putImageData(diffImg, 0, 0);

  // === Pass 3: build normal canvas from lightness gradient ===
  // Higher lightness = raised area, so we negate the gradient. Convert
  // (dx, dy) into a 3D unit vector and encode (X, Y, Z) as RGB. Strength
  // tunes how pronounced the bumps read; 6 is a subtle, "weathered marble"
  // feel — higher reads as plastic.
  const NORMAL_STRENGTH = 6;
  const { canvas: normCanvas, ctx: normCtx } = fillCanvas(size, size);
  const normImg = normCtx.createImageData(size, size);
  const normData = normImg.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xL = Math.max(0, x - 1);
      const xR = Math.min(size - 1, x + 1);
      const yU = Math.max(0, y - 1);
      const yD = Math.min(size - 1, y + 1);
      const lL = lightness[y * size + xL];
      const lR = lightness[y * size + xR];
      const lU = lightness[yU * size + x];
      const lD = lightness[yD * size + x];
      const dx = (lR - lL) * 0.5 * NORMAL_STRENGTH;
      const dy = (lD - lU) * 0.5 * NORMAL_STRENGTH;
      const nxN = -dx;
      const nyN = -dy;
      const nzN = 1.0;
      const len = Math.sqrt(nxN * nxN + nyN * nyN + nzN * nzN) || 1;
      const off = (y * size + x) * 4;
      normData[off] = Math.round((nxN / len) * 127.5 + 127.5);
      normData[off + 1] = Math.round((nyN / len) * 127.5 + 127.5);
      normData[off + 2] = Math.round((nzN / len) * 127.5 + 127.5);
      normData[off + 3] = 255;
    }
  }
  normCtx.putImageData(normImg, 0, 0);

  // === Pass 4: build roughness canvas ===
  // Marble is slightly polished where the white base is exposed, and
  // lies rougher along vein mineral depsits. Map: brighter pixels (high
  // lightness) = lower roughness, darker (vein) = higher. We use the
  // diffuse lightness directly and bias the range into a believable
  // 0.45\u20130.78 spread so the material keeps the matte-marble character.
  const { canvas: roughCanvas, ctx: roughCtx } = fillCanvas(size, size);
  const roughImg = roughCtx.createImageData(size, size);
  const roughData = roughImg.data;
  for (let i = 0; i < size * size; i++) {
    const l = lightness[i];
    // 0.55 base + (0.5 - l) * 0.30 spread — keeps every pixel inside a
    // marble-character range (≈0.40..0.70) so the brightest spots don't
    // dip into glass-glossy territory. Veins get visibly rougher than
    // the polished base, but nothing ever reads as a mirror finish.
    const r = Math.max(0, Math.min(1, 0.55 + (0.5 - l) * 0.30));
    const v = Math.round(r * 255);
    const off = i * 4;
    roughData[off] = v;
    roughData[off + 1] = v;
    roughData[off + 2] = v;
    roughData[off + 3] = 255;
  }
  roughCtx.putImageData(roughImg, 0, 0);

  const toTex = (canvas: HTMLCanvasElement) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  };

  return {
    diffuse: toTex(diffCanvas),
    normal: toTex(normCanvas),
    roughness: toTex(roughCanvas),
  };
}

const WHITE_COLOR = new THREE.Color(0xfaf5eb);
// After ExtrudeGeometry creates the 3D shape, its default UVs map the
// texture flat across the 2D silhouette's XY bounding box. That makes
// marble look like a flat photograph stretched across the horse face
// (or any extruded shape). We replace those UVs with a cylindrical
// projection: U = atan2(z - zCenter, x) wraps once around the Y axis,
// V = (y - yMin) / (yRange) maps along the height. The marble now wraps
// around the head like a stone hood instead of a flat painting, which
// reads as a real marble object.
//
// We don't try to offset the seam — atan2's discontinuity at theta=-π
// lands near the muzzle tip (x ≈ -0.25) and marble has no natural
// direction, so a seam isn't a hard visible artifact. Bevel vertices
// get interpolated UVs for free, since their (x,y,z) positions lie
// between the front and back caps.
function remapExtrudeToCylindricalUVs(geometry: THREE.ExtrudeGeometry): void {
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  if (!bbox) return;
  const yMin = bbox.min.y;
  const yMax = bbox.max.y;
  const yRange = Math.max(yMax - yMin, 1e-6);
  const zCenter = (bbox.min.z + bbox.max.z) / 2;

  const positions = geometry.attributes.position;
  const uvs = new Float32Array(positions.count * 2);

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    // atan2 → [-π, π]; divide by 2π and bias to [0, 1].
    const theta = Math.atan2(z - zCenter, x);
    const u = theta / (2 * Math.PI) + 0.5;
    const v = (y - yMin) / yRange;
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
}

// Sixteen distinct marble-variant bundles (diffuse + normal + roughness)
// baked at module load, one per black piece on a full board
// (16 * 3 textures * 256x256 RGBA ~ 12 MB GPU VRAM — negligible). Each
// dark piece picks a bundle via a hash of its world position, hard-bound
// at mount time so the variant never swaps mid-game. The bundles all share
// the same marblerecipe driver, so any tweak to the recipe keeps
// diffuse/normal/roughness locked in sync.
const BLACK_MARBLE_TINT = new THREE.Color(0xd0d0d0);
const BLACK_MARBLE_VARIANTS: MarbleSurfaces[] = Array.from(
  { length: 16 },
  (_, i) => createDarkGreyMarbleSurfaces(256, i + 1),
);
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
    // Replace ExtrudeGeometry's flat XY-bbox UVs with a cylindrical
    // wrap so the procedural marble doesn't read as a flat photograph
    // stretched across the horse face.
    remapExtrudeToCylindricalUVs(headGeo);

    return { baseGeo, headGeo };
  }, [pieceType]);

  const scale = PIECE_SCALE[pieceType] || 1;
  const isWhite = color === 'w';

  // Each dark piece gets a different procedural marble variant. We bind
  // the variant at MOUNT time (useState lazy init, not useMemo) so it's
  // rock-solid stable across re-renders AND during piece-move animations
  // (where `position` is interpolated by useChessAnimations and would
  // otherwise re-trigger a useMemo recompute, swapping the marble
  // texture mid-flight). Each piece keeps the same variant across its
  // whole lifetime in the game.
  const [marbleVariantIdx] = useState(() => {
    // Drop position[1] (Y) from the hash: Y is the lift axis for
    // animated moves, so even with useState (which only runs once),
    // hashing on Y makes the variant differ for the same piece on a
    // future remount if the animation Y happens to differ. X/Z alone
    // uniquely identify which board square a piece is on.
    const s = Math.sin(position[0] * 12.9898 + position[2] * 37.719) * 43758.5453;
    return Math.floor(Math.abs(s - Math.floor(s)) * BLACK_MARBLE_VARIANTS.length);
  });

  // Dark pieces wear a procedural marble albedo + normal + roughness
  // bundle; light pieces stay as plain ivory. useMemo avoids reallocating
  // the override every render (which would trigger an unnecessary
  // material-diff check inside R3F). normalScale is intentionally mild
  // (0.5) so the marble reads as weathered stone, not plastic.
  const pieceMaterialOverride = useMemo(() => {
    const variant = BLACK_MARBLE_VARIANTS[marbleVariantIdx];
    return isWhite
      ? { color: WHITE_COLOR, metalness: 0.08, roughness: 0.4, envMapIntensity: 0.6 }
      : {
          color: BLACK_MARBLE_TINT,
          map: variant.diffuse,
          normalMap: variant.normal,
          normalScale: new THREE.Vector2(0.5, 0.5),
          roughnessMap: variant.roughness,
          metalness: 0.05,
          // 1.0 means the roughnessMap dictates all variation \u2014 every
          // pixel's final roughness is exactly texture * 1.0.
          roughness: 1.0,
          envMapIntensity: 0.4,
        };
  }, [isWhite, marbleVariantIdx]);

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
                {...pieceMaterialOverride}
                emissive={emissiveColor}
                emissiveIntensity={emissiveIntensity}
                transparent={opacity < 1}
                opacity={opacity}
              />
            </mesh>
            <mesh
              geometry={knightGeometries.headGeo}
              position={[0, 0, -0.095]}
              castShadow
              receiveShadow
            >
              <meshStandardMaterial
                {...pieceMaterialOverride}
                emissive={emissiveColor}
                emissiveIntensity={emissiveIntensity}
                transparent={opacity < 1}
                opacity={opacity}
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
              {...pieceMaterialOverride}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
              transparent={opacity < 1}
              opacity={opacity}
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
