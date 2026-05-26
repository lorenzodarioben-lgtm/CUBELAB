import { lazy, Suspense, useEffect, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import { useServices, useUi } from './context';
import { toggleZen } from './actions';
import { useKeyboard } from '../hooks/useKeyboard';
import { useEnvironmentSync } from '../hooks/useEnvironment';
import { Header } from '../components/Header';
import { Stage } from '../components/stage/Stage';
import { TimerPanel } from '../components/panels/TimerPanel';
import { MoveLog } from '../components/panels/MoveLog';
import { ScramblePanel } from '../components/panels/ScramblePanel';
import { StatsPanel } from '../components/panels/StatsPanel';
import { HistoryDrawer } from '../components/panels/HistoryDrawer';
import { SettingsDialog } from '../components/panels/SettingsDialog';
import { HelpDialog } from '../components/panels/HelpDialog';
import { ActionPanel } from '../components/controls/ActionPanel';
import { MovePad } from '../components/controls/MovePad';
import { PlaybackPanel } from '../components/controls/PlaybackPanel';
import { ConfirmDialog, LiveRegion, Toast } from '../components/ui/Overlays';
import { Button } from '../components/ui/primitives';
import { cx } from '../components/ui/cx';
import { puzzleEvent } from '../core/puzzleCatalog';
import type { PuzzleEventId } from '../core/puzzleCatalog';

const NxNStudio = lazy(() => import('../components/nxn/NxNStudio').then((module) => ({ default: module.NxNStudio })));
const ShapeStudio = lazy(() => import('../components/shapes/ShapeStudio').then((module) => ({ default: module.ShapeStudio })));

function puzzleFromUrl(): PuzzleEventId {
  return puzzleEvent(new URLSearchParams(window.location.search).get('puzzle') ?? '')?.id ?? '333';
}

export function App() {
  const services = useServices();
  const zen = useUi((s) => s.zen);
  const [puzzle, setPuzzle] = useState<PuzzleEventId>(puzzleFromUrl);
  useKeyboard(services, puzzle === '333');
  useEnvironmentSync(services);

  useEffect(() => {
    const onPopState = () => setPuzzle(puzzleFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const choosePuzzle = (id: PuzzleEventId) => {
    if (id === puzzle) return;
    const url = new URL(window.location.href);
    if (id === '333') url.searchParams.delete('puzzle');
    else url.searchParams.set('puzzle', id);
    window.history.pushState(null, '', url);
    setPuzzle(id);
  };

  return (
    <div className={cx('app', puzzle === '333' && zen && 'is-zen')}>
      <div className="backdrop" aria-hidden />
      <Header puzzle={puzzle} onPuzzleChange={choosePuzzle} />
      {puzzle === '333' ? <>
      <main className="studio" id="studio">
        <h1 className="sr-only">CUBELAB — interactive 3×3×3 cube studio</h1>
        <section className="studio__stage" aria-label="3D cube. Drag stickers to twist, drag the background to orbit.">
          <Stage />
        </section>
        <div className="rail rail--left">
          <TimerPanel />
          <MoveLog />
          <ScramblePanel />
          <StatsPanel />
        </div>
        <div className="rail rail--right">
          <ActionPanel />
          <MovePad />
        </div>
        <div className="studio__playback">
          <PlaybackPanel />
        </div>
      </main>
      {zen && (
        <Button className="zen-exit" variant="ghost" size="sm" icon={<Minimize2 size={15} />} onClick={() => toggleZen(services, false)} kbd="Esc">
          Exit zen
        </Button>
      )}
      <HistoryDrawer />
      <SettingsDialog />
      <HelpDialog />
      <ConfirmDialog />
      <Toast />
      <LiveRegion />
      </> : <Suspense fallback={<div className="nxn-loading" role="status">Preparing {puzzleEvent(puzzle)?.shortLabel}…</div>}>
        {puzzle === 'pyram' || puzzle === 'skewb' || puzzle === 'minx' ? <ShapeStudio key={puzzle} eventId={puzzle} /> : <NxNStudio key={puzzle} eventId={puzzle} />}
      </Suspense>}
    </div>
  );
}
