import { useState } from 'react';
import { Focus, Maximize2, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import { useServices, useStudio, useUi } from '../app/context';
import { requestReset, toggleZen } from '../app/actions';
import { Stage } from './stage/Stage';
import { TimerPanel } from './panels/TimerPanel';
import { MoveLog } from './panels/MoveLog';
import { ScramblePanel } from './panels/ScramblePanel';
import { StatsPanel } from './panels/StatsPanel';
import { ActionPanel } from './controls/ActionPanel';
import { MovePad } from './controls/MovePad';
import { PlaybackPanel } from './controls/PlaybackPanel';
import { Button, Dialog, Segmented } from './ui/primitives';

export function MobileStudio() {
  const services = useServices();
  const { studio, rig } = services;
  const zen = useUi(s => s.zen);
  const canUndo = useStudio(s => s.canUndo);
  const canRedo = useStudio(s => s.canRedo);
  const blocked = useStudio(s => s.scramble.status === 'generating' || s.scramble.status === 'applying' || s.solver.status === 'solving' || s.solver.status === 'playing' || (s.settings.timerMode === 'spacebar' && ['ready','inspecting','arming'].includes(s.timer.phase)));
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'moves' | 'session' | 'more'>('moves');
  const close = () => setOpen(false);
  return (
    <main className="mobile-studio" id="studio">
      <h1 className="sr-only">CUBELAB — interactive 3×3×3 cube studio</h1>
      <TimerPanel />
      <section className="studio__stage" aria-label="Interactive cube. Twist a layer or orbit the view."><Stage /></section>
      <div className="mobile-playback"><PlaybackPanel /></div>
      {!zen && <ActionPanel mobile onOpenTools={() => setOpen(true)} />}
      <Dialog open={open} onClose={close} title="Cube tools" className="mobile-tools">
        <Segmented label="Cube tools section" value={tab} onChange={setTab} options={[
          { value: 'moves', label: 'Move pad' }, { value: 'session', label: 'Session' }, { value: 'more', label: 'More' },
        ]} />
        {tab === 'moves' && <MovePad expanded />}
        {tab === 'session' && <><ScramblePanel /><MoveLog /><StatsPanel /></>}
        {tab === 'more' && <div className="mobile-tools__actions">
          <Button icon={<Undo2 size={18} />} disabled={!canUndo || blocked} onClick={() => studio.undo()}>Undo</Button>
          <Button icon={<Redo2 size={18} />} disabled={!canRedo || blocked} onClick={() => studio.redo()}>Redo</Button>
          <Button icon={<RotateCcw size={18} />} onClick={() => { close(); requestReset(services); }}>Reset cube</Button>
          <Button icon={<Focus size={18} />} onClick={() => { close(); rig.reset(); }}>Reset camera</Button>
          <Button icon={<Maximize2 size={18} />} onClick={() => { close(); void toggleZen(services); }}>Zen mode</Button>
        </div>}
      </Dialog>
    </main>
  );
}
