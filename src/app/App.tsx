import { Minimize2 } from 'lucide-react';
import { useServices, useUi } from './context';
import { toggleZen } from './actions';
import { useKeyboard } from '../hooks/useKeyboard';
import { useEnvironmentSync } from '../hooks/useEnvironment';
import { Header } from '../components/Header';
import { Stage } from '../components/stage/Stage';
import { TimerPanel } from '../components/panels/TimerPanel';
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

export function App() {
  const services = useServices();
  const zen = useUi((s) => s.zen);
  useKeyboard(services);
  useEnvironmentSync(services);

  return (
    <div className={cx('app', zen && 'is-zen')}>
      <div className="backdrop" aria-hidden />
      <Header />
      <main className="studio" id="studio">
        <h1 className="sr-only">CUBELAB — interactive 3×3×3 cube studio</h1>
        <section className="studio__stage" aria-label="3D cube. Drag stickers to twist, drag the background to orbit.">
          <Stage />
        </section>
        <div className="rail rail--left">
          <TimerPanel />
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
    </div>
  );
}
