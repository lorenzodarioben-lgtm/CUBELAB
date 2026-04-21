/**
 * The reflection environment: a small photographic studio, built in code and
 * prefiltered once (PMREM) into the scene's image-based lighting.
 *
 * A dark graded cyclorama (near-black floor rising to a dim warm-grey
 * ceiling) holds a handful of large diffused softboxes and strip lights, the
 * way a product photographer lights glossy plastic: a broad overhead box for
 * the top face, a tall key strip front-left, a rim strip behind, a low fill
 * card and a faint floor bounce. Their edges are what glossy tiles and the
 * rounded black plastic pick up as soft highlights, and because the cube turns
 * inside this fixed studio those highlights travel across it as it moves.
 *
 * Values are linear HDR radiance (the target is half-float), so panels can be
 * many times brighter than the surroundings, like real lights.
 */
import * as THREE from 'three';

interface Panel {
  /** Width × height in studio units (the cube is 3 wide). */
  readonly size: readonly [number, number];
  readonly position: readonly [number, number, number];
  readonly radiance: number;
  /** Slight warm/cool cast, like mixed real lamps. */
  readonly tint?: string;
  readonly round?: boolean;
}

const PANELS: readonly Panel[] = [
  // Broad overhead softbox: the soft top light.
  { size: [11, 7], position: [-1.2, 9, -2.4], radiance: 2.3, tint: '#fffaf4' },
  // Strip softbox high behind-left, placed so its lower edge crosses the top
  // face's mirror direction from the home view: half the top face carries a
  // soft reflection, the other half falls off — the classic glossy product look.
  { size: [7, 2.6], position: [-4.6, 6.4, -6.1], radiance: 1.7 },
  // Tall key strip, front-left.
  { size: [2.6, 10], position: [-8, 2.6, 5], radiance: 2.4, tint: '#fff7ee' },
  // Rim strip behind-right: bright edges on the far silhouette.
  { size: [2, 10], position: [7.5, 3.2, -5.5], radiance: 2.6 },
  // Right side strip: lifts the R face a touch.
  { size: [3.2, 8], position: [9, 1.6, 1.8], radiance: 2.2, tint: '#f4f7ff' },
  // Low front fill card (what a photographer bounces in under the lens).
  { size: [7, 2.4], position: [1, 0.2, 9.5], radiance: 0.85, tint: '#fffaf2' },
  // Bounce cards low front-left and low back-right, where the F and R faces
  // mirror from the home view: a faint sheen that sets glossy tiles apart.
  { size: [10, 4.4], position: [-5.6, -3.9, 7.4], radiance: 0.75, tint: '#fff8f0' },
  { size: [10, 4.4], position: [5.6, -3.9, -7.4], radiance: 0.45, tint: '#f6f8ff' },
];

const FLOOR = new THREE.Color('#050506');
const HORIZON = new THREE.Color('#141417');
const CEILING = new THREE.Color('#2b2a2d');

function buildStudio(): THREE.Scene {
  const scene = new THREE.Scene();

  // Cyclorama: a sphere graded by height, seen from inside.
  const dome = new THREE.SphereGeometry(30, 64, 32);
  const position = dome.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = position.getY(i) / 30;
    if (t < 0) c.copy(HORIZON).lerp(FLOOR, Math.min(1, -t * 2.5));
    else c.copy(HORIZON).lerp(CEILING, Math.pow(t, 0.8));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  dome.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  for (const panel of PANELS) {
    const geometry = panel.round ? new THREE.CircleGeometry(panel.size[0] / 2, 48) : new THREE.PlaneGeometry(panel.size[0], panel.size[1]);
    const color = new THREE.Color(panel.tint ?? '#ffffff').multiplyScalar(panel.radiance);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    mesh.position.set(...panel.position);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  }

  // Faint floor bounce under the cube.
  const bounce = new THREE.Mesh(
    new THREE.CircleGeometry(5, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(0.12), side: THREE.DoubleSide }),
  );
  bounce.position.set(0, -6, 0);
  bounce.lookAt(0, 0, 0);
  scene.add(bounce);
  return scene;
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
}

/**
 * Renders the studio into a prefiltered environment map and installs it as
 * the scene's image-based lighting. Returns a cleanup that restores the scene
 * and frees the GPU texture.
 */
export function installStudioEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, intensity: number, size: number): () => void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = buildStudio();
  const target = pmrem.fromScene(studio, 0.02, 0.1, 60, { size });
  disposeScene(studio);
  pmrem.dispose();
  const previous = { environment: scene.environment, intensity: scene.environmentIntensity };
  scene.environment = target.texture;
  scene.environmentIntensity = intensity;
  return () => {
    scene.environment = previous.environment;
    scene.environmentIntensity = previous.intensity;
    target.dispose();
  };
}
