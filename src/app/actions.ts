/**
 * User-facing commands shared by buttons and keyboard shortcuts, including the
 * confirmation step for anything that would discard a timed attempt.
 */
import type { AppServices } from './context';

export function requestNewScramble({ studio, ui }: AppServices): void {
  void studio.newScramble().then((result) => {
    if (result !== 'confirm') return;
    ui.setState({
      confirm: {
        kind: 'scramble',
        title: 'Discard this attempt?',
        body: 'A timed attempt is in progress. Starting a new scramble discards it — it will not be recorded.',
        confirmLabel: 'Discard & scramble',
        onConfirm: () => void studio.newScramble({ force: true }),
      },
    });
  });
}

export function requestReset({ studio, ui }: AppServices): void {
  if (studio.reset() !== 'confirm') return;
  ui.setState({
    confirm: {
      kind: 'reset',
      title: 'Reset the cube?',
      body: 'A timed attempt is in progress. Resetting restores the solved cube and discards the attempt — it will not be recorded.',
      confirmLabel: 'Discard & reset',
      onConfirm: () => studio.reset({ force: true }),
    },
  });
}

export function requestAutoSolve({ studio, ui }: AppServices): void {
  const phase = studio.state.timer.phase;
  if (phase === 'running' || phase === 'inspecting' || phase === 'arming') {
    ui.setState({
      confirm: {
        kind: 'solve',
        title: 'Use Auto Solve?',
        body: 'Auto Solve ends the current attempt. It will be marked as assisted and not recorded.',
        confirmLabel: 'Solve it for me',
        onConfirm: () => void studio.autoSolve(),
      },
    });
    return;
  }
  void studio.autoSolve();
}

export function toggleZen({ ui }: AppServices, on?: boolean): void {
  const next = on ?? !ui.getState().zen;
  ui.setState({ zen: next });
  try {
    if (next && document.fullscreenEnabled && !document.fullscreenElement) {
      void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    } else if (!next && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  } catch {
    /* fullscreen unsupported: zen still hides the panels */
  }
}
