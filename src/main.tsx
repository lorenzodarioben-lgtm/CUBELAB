import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/instrument-sans/standard.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/nxn.css';
import { App } from './app/App';
import { ServicesContext } from './app/context';
import type { AppServices } from './app/context';
import { Studio } from './app/studio';
import { createUiStore } from './app/uiStore';
import { installDebugApi } from './app/debug';
import { loadKPuzzle } from './core/puzzle/kpattern';
import { browserStore } from './core/persistence/storage';
import { createSoundPlayer } from './core/audio/sound';
import { prewarmScrambler } from './core/scramble/scrambler';
import { OrbitRig } from './components/stage/orbitRig';

function readSharedScramble(): string | null {
  const params = new URLSearchParams(window.location.search);
  const text = params.get('scramble');
  if (text === null) return null;
  params.delete('scramble');
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  return text.slice(0, 400);
}

async function boot(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) return;
  try {
    const kpuzzle = await loadKPuzzle();
    const studio = new Studio({
      kpuzzle,
      storage: browserStore(),
      sound: createSoundPlayer(),
      scheduleFrame: (callback) => requestAnimationFrame(() => callback()),
    });
    const services: AppServices = { studio, ui: createUiStore(), rig: new OrbitRig() };
    installDebugApi(studio, services.rig);

    createRoot(root).render(
      <StrictMode>
        <ServicesContext value={services}>
          <App />
        </ServicesContext>
      </StrictMode>,
    );

    const shared = readSharedScramble();
    if (shared) {
      void studio.newScramble({ text: shared, force: true }).then(() => {
        if (studio.state.scramble.origin === 'shared') studio.notify('info', 'Loaded a shared scramble.');
      });
    }

    // Boot the scramble/solver worker when the browser is idle so the first
    // New Scramble is instant. Purely local computation; no network.
    const idle = (cb: () => void) => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 4000 });
      else window.setTimeout(cb, 2500);
    };
    idle(() => void prewarmScrambler().catch(() => undefined));
  } catch (error) {
    console.error(error);
    root.innerHTML =
      '<div style="padding:32px;font-family:system-ui;color:#ddd;background:#0a0b10;min-height:100vh">CUBELAB could not start: the puzzle definition failed to load. Please reload the page.</div>';
  }
}

void boot();
