/** Presentation-only state (open overlays, zen mode, renderer health). */
import { createStore } from 'zustand/vanilla';

export type ConfirmKind = 'reset' | 'scramble' | 'solve' | 'clear-history' | 'mode-change';

export interface ConfirmRequest {
  readonly kind: ConfirmKind;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
}

export type RendererStatus = 'loading' | 'ready' | 'unsupported' | 'error';

export interface UiState {
  readonly helpOpen: boolean;
  readonly settingsOpen: boolean;
  readonly historyOpen: boolean;
  readonly zen: boolean;
  readonly confirm: ConfirmRequest | null;
  readonly renderer: RendererStatus;
  readonly gestureHint: boolean;
}

const HINT_KEY = 'cubelab.gestureHintSeen';

function hintSeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markGestureHintSeen(): void {
  try {
    window.localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* not critical */
  }
}

export function createUiStore() {
  return createStore<UiState>(() => ({
    helpOpen: false,
    settingsOpen: false,
    historyOpen: false,
    zen: false,
    confirm: null,
    renderer: 'loading',
    gestureHint: typeof window !== 'undefined' ? !hintSeen() : false,
  }));
}

export type UiStore = ReturnType<typeof createUiStore>;
