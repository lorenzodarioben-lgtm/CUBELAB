import { describe, expect, it } from 'vitest';
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { mobileFitDistance } from '../../src/components/stage/mobileFraming';
import { HOME_POSE, sphericalPosition } from '../../src/components/stage/orbitRig';
import { MAX_SURFACE_OFFSET, SPACING } from '../../src/components/cube/cubeResources';
import type { VisualTurn } from '../../src/core/engine/cubeEngine';

const half = SPACING + MAX_SURFACE_OFFSET;
const orientations = [new Quaternion(), ...[[.7,1.3,.9],[2.3,.4,1.7],[Math.PI,0,0]].map(([x,y,z]) => new Quaternion().setFromEuler(new Euler(x,y,z)))];
const turns: (VisualTurn | null)[] = [null];
for (const axis of [0,1,2] as const) for (const layer of [-1,0,1,null] as const) {
  turns.push({ axis, layer, angle: Math.PI / 4, cubies: [] });
}

describe('mobile perspective framing', () => {
  it.each([[320,230],[360,440],[390,560],[430,650],[610,180]])('keeps cubies and moving layers inside %sx%s through tumbles', (width,height) => {
    // Independently project the 27 physical cubie boxes through a real camera,
    // including a 45-degree turn, rather than reusing the fit's bounding boxes.
    for (const rotation of orientations) for (const turn of turns) {
      const distance = mobileFitDistance(width,height,half,27,rotation,turn);
      const camera = new PerspectiveCamera(27,width/height,.1,100);
      camera.position.set(...sphericalPosition(distance,HOME_POSE));
      camera.lookAt(0,0,0); camera.updateMatrixWorld();
      const axis = new Vector3().setComponent(turn?.axis ?? 0,1);
      let reach = 0;
      for (const x of [-1,0,1]) for (const y of [-1,0,1]) for (const z of [-1,0,1]) {
        const moving = turn && (turn.layer === null || [x,y,z][turn.axis] === turn.layer);
        for (const dx of [-MAX_SURFACE_OFFSET,MAX_SURFACE_OFFSET]) for (const dy of [-MAX_SURFACE_OFFSET,MAX_SURFACE_OFFSET]) for (const dz of [-MAX_SURFACE_OFFSET,MAX_SURFACE_OFFSET]) {
          const point = new Vector3(x+dx,y+dy,z+dz);
          if (moving) point.applyAxisAngle(axis,turn.angle);
          point.applyQuaternion(rotation).project(camera);
          expect(Math.abs(point.x)*width/2).toBeLessThanOrEqual(width/2-11.99);
          expect(Math.abs(point.y)*height/2).toBeLessThanOrEqual(height/2-11.99);
          reach = Math.max(reach,Math.abs(point.x)*width/(width-24),Math.abs(point.y)*height/(height-24));
        }
      }
      expect(reach, JSON.stringify({rotation:rotation.toArray(),turn})).toBeGreaterThan(.96);
    }
  });
});
