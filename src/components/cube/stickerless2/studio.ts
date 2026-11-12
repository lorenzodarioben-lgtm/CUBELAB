/**
 * Stickerless v2's studio, k2 (Y's layout, restrained; approved after the
 * lighting review on exp/y-lighting): a product set with its own room, key
 * softbox and reflection panels in place of production's Stickerless studio,
 * plus near-field transport: each surface a turn opens sees the other layers
 * as geometry (they hide part of the studio and cast the key's shadow) and
 * mirrors them in its gloss. It is built once per tier into the same two
 * prefiltered maps as production, so it costs the same per frame.
 *
 * The other studios compared during the reviews, and the reviews themselves,
 * are kept on the development branches (stickerless-v2-phase01,
 * exp/y-lighting), not here.
 *
 * Panels are placed in the studio's world frame, from the home view: at home
 * the camera looks from (0.50, 0.54, 0.67); U mirrors toward up-back-left, F
 * toward low-front-left, R toward low-back-right, and the rims between them
 * sweep the arcs in between. The studio is laid out in the home camera's own
 * frame (right, up, toward the camera), as the view turns the cube in front of
 * that fixed camera.
 */
import type { Panel, Room } from '../../stage/stickerlessEnvironment';
import { fromHomeCamera } from '../../stage/stickerlessEnvironment';

/** The near-field light transport a studio uses (`material.ts`, `V2_TRANSPORT`). */
export interface TransportV2 {
  /** The gloss mirrors the other layers where the reflected ray meets them (their lit plastic, not the studio). */
  readonly specular: boolean;
  /** The other layers' lit plastic adds its diffuse bounce where it fills the view. */
  readonly bounce: boolean;
  /** Opened surfaces see the studio only past the other layers (exact solid angle), and their key-light shadow. */
  readonly internal: boolean;
  /** The mirrored layers carry their own gloss (their reflection of the studio). */
  readonly sheen: boolean;
}

export interface StudioV2 {
  readonly room: Room;
  readonly panels: readonly Panel[];
  /** Gain on the indirect (studio) light received by internal plastic. */
  readonly innerLight: number;
  /** The key softbox (home camera frame) in place of production's window; it also drives the key light. */
  readonly key: Panel;
  /** Gain on the key light's intensity over the key softbox's own (1: the softbox's first moment). */
  readonly keyLight: number;
  /** Whether production's fill strips are part of the studio. */
  readonly fill: boolean;
  /** Exposure of the v2 plastic before tone mapping (the stage's own exposure is unchanged). */
  readonly exposure: number;
  readonly transport: TransportV2;
}

const WHITE = '#ffffff';

/** A panel placed in the home camera's frame (right, up, toward the camera). */
function onCamera(panel: Panel): Panel {
  const p = fromHomeCamera(panel.position);
  return { ...panel, position: [p.x, p.y, p.z] };
}

/**
 * The studio: a product set in a mid-grey surround, all emitters neutral white.
 * The key softbox upper left, which also drives the key light, does most of
 * the diffuse work, so lit faces read clean without a ring of equal
 * reflections. Two smaller, dimmer softboxes upper right and low right give
 * the faces turned that way a defined gloss, and a broad dim fill low left
 * lifts the faces tipped toward the viewer without a coloured wash. A dim,
 * graded strip overhead behind lights the faces turned away (the plastic a
 * turn exposes mirrors it) without a pale sheet on the top face, two strips
 * behind give the silhouette its rim lines, and a dim card low right gives the
 * right-hand faces a soft sheen at grazing angles.
 */
const PRODUCT_ROOM: Room = { colors: ['#5a5a5a', '#5a5a5a', '#5a5a5a', '#5a5a5a', '#5a5a5a', '#5a5a5a'], radiance: 3 };
const PRODUCT_KEY: Panel = { position: [-6, 4.5, 4.5], size: [4.5, 4.5], radiance: 9, tint: WHITE, falloff: 0.35 };
const PRODUCT_PANELS: readonly Panel[] = [
  onCamera({ position: [6, 4.5, 4.5], size: [3.6, 3.6], radiance: 4.125, tint: WHITE, falloff: 0.45 }),
  onCamera({ position: [6, -4.5, 4.5], size: [3.6, 3.6], radiance: 4.95, tint: WHITE, falloff: 0.45 }),
  onCamera({ position: [0, 7, -6], size: [8, 3], radiance: 2.2, tint: WHITE, falloff: 0.55, grade: 0.8 }),
  onCamera({ position: [7, -5, -6], size: [6, 6], radiance: 0.8, tint: WHITE, falloff: 0.7, grade: 0.7 }),
  onCamera({ position: [-7, 1, -5], size: [1.2, 10], radiance: 7, tint: WHITE, falloff: 0.3 }),
  onCamera({ position: [7, 1, -5], size: [1.2, 10], radiance: 7, tint: WHITE, falloff: 0.3 }),
  onCamera({ position: [-5, -6, 4], size: [7, 3], radiance: 1.6, tint: WHITE, falloff: 0.7 }),
];

/** k2, the approved v2 lighting. */
export const V2_STUDIO: StudioV2 = {
  room: PRODUCT_ROOM,
  panels: PRODUCT_PANELS,
  key: PRODUCT_KEY,
  keyLight: 1.5,
  fill: false,
  innerLight: 1,
  exposure: 1.15,
  transport: { specular: true, bounce: false, internal: true, sheen: false },
};

/** The transport flags as the shader's vec4 (specular, bounce, internal, sheen). */
export function transportVector(t: TransportV2): [number, number, number, number] {
  return [+t.specular, +t.bounce, +t.internal, +t.sheen];
}

/** A GLSL float literal (always with a decimal point). */
function glslFloat(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

/**
 * The studio's values as shader constants, so the compiler drops what it does
 * not use (for Y: the bounce and sheen paths and the internal-light gain).
 */
export function fixedStudioDefines(studio: StudioV2 = V2_STUDIO): Record<string, string> {
  const defines: Record<string, string> = {};
  if (studio.innerLight !== 1) defines.V2_INNER_FIXED = glslFloat(studio.innerLight);
  if (studio.exposure !== 1) defines.V2_EXPOSURE_FIXED = glslFloat(studio.exposure);
  const flags = transportVector(studio.transport);
  if (flags.some(Boolean)) {
    defines.V2_TRANSPORT = '';
    defines.V2_TRANSPORT_FLAGS = flags.map(glslFloat).join(', ');
  }
  return defines;
}
