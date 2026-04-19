/**
 * Read-only inspection hooks on `window.__CUBELAB__`, used by the browser test
 * suite to compare the rendered stickers with the canonical model. Nothing
 * here can change state.
 */
import { isSolved, stateFacelets } from '../core/puzzle/cubeState';
import { patternFacelets } from '../core/puzzle/kpattern';
import { formatAlg } from '../core/puzzle/notation';
import type { Studio } from './studio';
import type { OrbitRig } from '../components/stage/orbitRig';

export interface DebugApi {
  version(): number;
  facelets(): string;
  patternFacelets(): string;
  solved(): boolean;
  idle(): boolean;
  camera(): { azimuth: number; polar: number; zoom: number };
  timer(): { phase: string; mode: string; startedAt: number | null; turns: number };
  historyCount(): number;
  scramble(): string | null;
  solver(): { status: string; cursor: number; total: number };
  /** The user's turns since the last scramble/reset, in notation. */
  moveLog(): string;
  /** Installed by the 3D stage once it is mounted. */
  visualFacelets?: () => string;
  project?: (point: [number, number, number]) => { x: number; y: number };
  renderInfo?: () => { geometries: number; textures: number; programs: number };
}

export function installDebugApi(studio: Studio, rig: OrbitRig): void {
  const api: DebugApi = {
    version: () => studio.engine.version,
    facelets: () => stateFacelets(studio.engine.state),
    patternFacelets: () => patternFacelets(studio.engine.state.pattern),
    solved: () => isSolved(studio.engine.state),
    idle: () => !studio.engine.isBusy(),
    camera: () => ({ ...rig.current }),
    timer: () => {
      const t = studio.state.timer;
      return { phase: t.phase, mode: t.mode, startedAt: t.startedAt, turns: t.turnsSTM };
    },
    historyCount: () => studio.state.history.length,
    scramble: () => studio.state.scramble.text,
    solver: () => ({ status: studio.state.solver.status, cursor: studio.state.solver.cursor, total: studio.state.solver.moves.length }),
    moveLog: () => formatAlg(studio.state.moveLog),
  };
  (window as unknown as { __CUBELAB__: DebugApi }).__CUBELAB__ = api;
}
