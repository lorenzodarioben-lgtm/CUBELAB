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
 *
 * The Premium Stickerless cube also gets its own reflection map: the same
 * studio plus large, soft-edged reflector cards where its front and right faces
 * mirror from the home view (what a photographer does for coloured gloss), so
 * the domed faces carry soft highlight bands. Only the stickerless materials
 * use it; the shared scene lighting (and so the stickered cube) is unchanged.
 */
import * as THREE from 'three';

export interface Panel {
  /** Width × height in studio units (the cube is 3 wide). */
  readonly size: readonly [number, number];
  readonly position: readonly [number, number, number];
  readonly radiance: number;
  /** Slight warm/cool cast, like mixed real lamps. */
  readonly tint?: string;
  readonly round?: boolean;
  /** Feathered edges (a soft scrim) instead of a hard-edged box. */
  readonly soft?: boolean;
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

/**
 * Reflector cards for the stickerless cube's own reflection map, placed a little
 * above where the F and R faces mirror from the home view, so each domed face
 * reflects a soft card edge: a highlight fading down across the face. Kept
 * dim — a coloured face must stay its colour, with only a sheen on top.
 */
export const STICKERLESS_REFLECTORS: readonly Panel[] = [
  { size: [11, 5], position: [-6.2, -4.2, 7.8], radiance: 0.8, tint: '#fff9f2', soft: true },
  { size: [11, 5], position: [6.2, -4.2, -7.8], radiance: 0.55, tint: '#f4f7ff', soft: true },
  // A wide, dim scrim behind the camera: a faint sheen on every face turned toward the viewer.
  { size: [18, 9], position: [5, 3, 11], radiance: 0.12, tint: '#fffaf4', soft: true },
];

/** A feathered card mask: 1 inside, easing to 0 over the outer `feather` of each side. */
function softCardTexture(feather = 0.3, size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const ramp = (t: number) => {
    const u = Math.min(1, Math.max(0, t / feather));
    return u * u * (3 - 2 * u);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const k = ramp(Math.min(u, 1 - u)) * ramp(Math.min(v, 1 - v));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(k * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const FLOOR = new THREE.Color('#050506');
const HORIZON = new THREE.Color('#141417');
const CEILING = new THREE.Color('#2b2a2d');

function buildStudio(extra: readonly Panel[] = []): THREE.Scene {
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

  for (const panel of [...PANELS, ...extra]) {
    const geometry = panel.round ? new THREE.CircleGeometry(panel.size[0] / 2, 48) : new THREE.PlaneGeometry(panel.size[0], panel.size[1]);
    const color = new THREE.Color(panel.tint ?? '#ffffff').multiplyScalar(panel.radiance);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, map: panel.soft ? softCardTexture() : null }));
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
      const material = object.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
    }
  });
}

/**
 * Renders the studio into a prefiltered environment map and installs it as
 * the scene's image-based lighting. Returns a cleanup that restores the scene
 * and frees the GPU texture.
 */
/** Renders a studio (plus `extra` panels) into a prefiltered environment map. */
export function renderEnvironment(renderer: THREE.WebGLRenderer, size: number, extra: readonly Panel[] = []): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = buildStudio(extra);
  const target = pmrem.fromScene(studio, 0.02, 0.1, 60, { size });
  disposeScene(studio);
  pmrem.dispose();
  return target;
}

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
