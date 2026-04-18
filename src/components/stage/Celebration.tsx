/**
 * Solved-state celebration: a soft ripple of light runs out across the floor
 * from the cube's base and fades — like a reflection on a studio table. No
 * confetti, no flashing. With reduced motion it simply fades in place.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStudio } from '../../app/context';

const DURATION = 1.6;

export function Celebration({ reduced }: { reduced: boolean; zen: boolean }) {
  const celebration = useStudio((s) => s.celebration);
  const invalidate = useThree((s) => s.invalidate);
  const start = useRef<number | null>(null);
  const rings = useRef<Array<THREE.Mesh | null>>([]);

  const geometry = useMemo(() => new THREE.RingGeometry(1.9, 1.93, 192), []);
  const materials = useMemo(
    () =>
      ['#fff6e6', '#ffffff'].map(
        (color) =>
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
          }),
      ),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      materials.forEach((m) => m.dispose());
    },
    [geometry, materials],
  );

  useEffect(() => {
    if (!celebration) return;
    start.current = performance.now();
    invalidate();
  }, [celebration, invalidate]);

  useFrame(() => {
    if (start.current === null) return;
    const t = (performance.now() - start.current) / 1000;
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const local = Math.max(0, t - i * 0.22) / DURATION;
      const material = materials[i]!;
      if (local >= 1) {
        material.opacity = 0;
        ring.visible = false;
        return;
      }
      ring.visible = true;
      const eased = 1 - (1 - local) ** 3;
      ring.scale.setScalar(reduced ? 1.1 : 1 + eased * 0.6);
      material.opacity = (reduced ? Math.sin(local * Math.PI) * 0.3 : (1 - local) ** 1.8 * 0.5) * (i === 0 ? 1 : 0.55);
    });
    if (t < DURATION + 0.3) invalidate();
    else start.current = null;
  });

  return (
    <group rotation-x={-Math.PI / 2} position={[0, -2.08, 0]}>
      {materials.map((material, i) => (
        <mesh
          key={i}
          ref={(m) => {
            rings.current[i] = m;
          }}
          geometry={geometry}
          material={material}
          visible={false}
        />
      ))}
    </group>
  );
}
