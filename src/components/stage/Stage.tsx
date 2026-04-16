/**
 * Stage shell: lazy-loads the WebGL scene, shows a purposeful skeleton while it
 * boots, and degrades to a 2D net (with Move Pad + keyboard still fully
 * functional) if WebGL is unavailable or the 3D layer throws.
 */
import { Component, Suspense, lazy, useMemo, useRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Focus, Hand, Move3d, Rotate3d } from 'lucide-react';
import { useServices, useStudio, useUi } from '../../app/context';
import type { StickerRegistry } from '../cube/CubeModel';
import type { PreviewSink } from './Interaction';
import { FaceNet } from './FaceNet';
import { StageHint } from '../ui/Overlays';
import { IconButton, Segmented } from '../ui/primitives';
import { cx } from '../ui/cx';

const StageCanvas = lazy(() => import('./StageCanvas'));

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

class StageBoundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('CUBELAB 3D stage failed; falling back to the 2D net.', error, info.componentStack);
    this.props.onError();
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Fallback({ reason }: { reason: 'unsupported' | 'error' }) {
  const facelets = useStudio((s) => s.facelets);
  return (
    <div className="stage-fallback">
      <FaceNet facelets={facelets} />
      <p className="stage-fallback__note">
        {reason === 'unsupported'
          ? '3D needs WebGL, which this browser or device has disabled. Everything else works: turn with the Move Pad or keyboard, scramble, time and auto-solve.'
          : 'The 3D view hit an error, so the cube is shown flat. Your cube, timer and history are unaffected.'}
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="stage-skeleton" role="status">
      <div className="stage-skeleton__cube" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <span className="stage-skeleton__label">Preparing the stage</span>
    </div>
  );
}

export function Stage() {
  const { studio, rig, ui } = useServices();
  const renderer = useUi((s) => s.renderer);
  const gestureHint = useUi((s) => s.gestureHint);
  const touchMode = useStudio((s) => s.settings.touchMode);
  const supported = useMemo(() => detectWebGL(), []);
  const registry = useMemo<StickerRegistry>(() => ({ meshes: [] }), []);
  const labelRef = useRef<HTMLDivElement>(null);

  const preview = useMemo<PreviewSink>(
    () => ({
      show(label, x, y) {
        const el = labelRef.current;
        if (!el) return;
        el.textContent = label ?? '·';
        el.dataset.ready = label ? 'true' : 'false';
        el.style.transform = `translate(${Math.round(x + 18)}px, ${Math.round(y - 42)}px)`;
        el.style.opacity = '1';
      },
      hide() {
        if (labelRef.current) labelRef.current.style.opacity = '0';
      },
    }),
    [],
  );

  const status = !supported ? 'unsupported' : renderer;

  return (
    <div className={cx('stage', `stage--${status}`)}>
      <div className="stage__orbits" aria-hidden>
        <svg viewBox="0 0 800 800">
          <circle cx="400" cy="400" r="300" />
          <circle cx="400" cy="400" r="372" className="dashed" />
          <circle cx="400" cy="400" r="232" className="faint" />
          <path d="M400 18v26M400 756v26M18 400h26M756 400h26" />
        </svg>
      </div>

      {status === 'unsupported' ? (
        <Fallback reason="unsupported" />
      ) : status === 'error' ? (
        <Fallback reason="error" />
      ) : (
        <StageBoundary fallback={<Fallback reason="error" />} onError={() => ui.setState({ renderer: 'error' })}>
          <Suspense fallback={<Skeleton />}>
            <div className="stage__canvas" data-touch-mode={touchMode}>
              <StageCanvas registry={registry} preview={preview} />
            </div>
          </Suspense>
          {renderer === 'loading' && <Skeleton />}
        </StageBoundary>
      )}

      <div ref={labelRef} className="twist-label" aria-hidden />
      <StageHint />

      {status === 'ready' && gestureHint && (
        <p className="gesture-hint">
          <span>
            <Hand size={13} aria-hidden /> Drag a sticker to twist
          </span>
          <span>
            <Rotate3d size={13} aria-hidden /> Drag background to orbit
          </span>
          <span className="gesture-hint__zoom">
            <Move3d size={13} aria-hidden /> Scroll or pinch to zoom
          </span>
        </p>
      )}

      <div className="stage__tools">
        <Segmented
          label="Single-finger drag"
          size="sm"
          className="touch-mode"
          value={touchMode}
          onChange={(value) => studio.updateSettings({ touchMode: value })}
          options={[
            { value: 'twist', label: 'Twist', title: 'Dragging the cube twists layers' },
            { value: 'orbit', label: 'Orbit', title: 'Dragging anywhere orbits the camera' },
          ]}
        />
        <IconButton label="Reset camera (C)" size="sm" onClick={() => rig.reset()} className="stage__camera">
          <Focus size={16} />
        </IconButton>
      </div>
    </div>
  );
}
