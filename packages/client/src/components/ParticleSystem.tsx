import React, { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ParticleEffect {
  id: string;
  position: [number, number, number];
  color: THREE.Color;
  startTime: number;
  type: 'capture' | 'checkmate';
}

interface ParticleSystemProps {
  effects: ParticleEffect[];
  onEffectComplete: (id: string) => void;
}

const PARTICLE_COUNT = 40;
const CAPTURE_DURATION = 1.0; // seconds
const CHECKMATE_DURATION = 2.0;

function CaptureParticles({
  effect,
  onComplete,
}: {
  effect: ParticleEffect;
  onComplete: () => void;
}) {
  const pointsRef = useRef<THREE.Points>(null!);
  const [completed, setCompleted] = useState(false);

  const { positions, velocities, sizes } = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const vel = new Float32Array(PARTICLE_COUNT * 3);
    const sz = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Start at capture position
      pos[i * 3] = effect.position[0];
      pos[i * 3 + 1] = effect.position[1] + 0.3;
      pos[i * 3 + 2] = effect.position[2];

      // Random burst velocity
      const angle = Math.random() * Math.PI * 2;
      const elevation = Math.random() * Math.PI * 0.6 + 0.2;
      const speed = 1.5 + Math.random() * 2.5;

      vel[i * 3] = Math.cos(angle) * Math.sin(elevation) * speed;
      vel[i * 3 + 1] = Math.cos(elevation) * speed * 1.2;
      vel[i * 3 + 2] = Math.sin(angle) * Math.sin(elevation) * speed;

      sz[i] = 0.04 + Math.random() * 0.06;
    }

    return { positions: pos, velocities: vel, sizes: sz };
  }, [effect.position]);

  useFrame((state) => {
    if (completed || !pointsRef.current) return;

    const elapsed = state.clock.elapsedTime - effect.startTime;
    const duration = effect.type === 'checkmate' ? CHECKMATE_DURATION : CAPTURE_DURATION;
    const progress = Math.min(elapsed / duration, 1);

    if (progress >= 1) {
      setCompleted(true);
      onComplete();
      return;
    }

    const posAttr = pointsRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;

    const gravity = -4.0;
    const dt = 1 / 60;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Apply velocity and gravity
      posArray[i * 3] += velocities[i * 3] * dt;
      posArray[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      posArray[i * 3 + 2] += velocities[i * 3 + 2] * dt;

      // Apply gravity to velocity
      velocities[i * 3 + 1] += gravity * dt;

      // Damping
      velocities[i * 3] *= 0.99;
      velocities[i * 3 + 2] *= 0.99;
    }

    posAttr.needsUpdate = true;

    // Fade out
    const material = pointsRef.current.material as THREE.PointsMaterial;
    material.opacity = 1 - progress * progress;
    material.size = 0.06 * (1 - progress * 0.5);
  });

  if (completed) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={PARTICLE_COUNT}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color={effect.color}
        size={0.06}
        transparent
        opacity={1}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export const ParticleSystem = React.memo(function ParticleSystem({
  effects,
  onEffectComplete,
}: ParticleSystemProps) {
  return (
    <>
      {effects.map((effect) => (
        <CaptureParticles
          key={effect.id}
          effect={effect}
          onComplete={() => onEffectComplete(effect.id)}
        />
      ))}
    </>
  );
});

export type { ParticleEffect };
