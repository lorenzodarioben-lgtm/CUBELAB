import { Focus, Redo2, RotateCcw, Shuffle, Sparkles, Undo2 } from 'lucide-react';
import { useServices, useStudio } from '../../app/context';
import { requestAutoSolve, requestNewScramble, requestReset } from '../../app/actions';
import { Button, IconButton, Spinner } from '../ui/primitives';

export function ActionPanel() {
  const services = useServices();
  const { studio, rig } = services;
  const scrambleStatus = useStudio((s) => s.scramble.status);
  const solverStatus = useStudio((s) => s.solver.status);
  const solverWarm = useStudio((s) => s.solver.warm);
  const solved = useStudio((s) => s.solved);
  const canUndo = useStudio((s) => s.canUndo);
  const canRedo = useStudio((s) => s.canRedo);
  const timerPhase = useStudio((s) => s.timer.phase);
  const timerMode = useStudio((s) => s.timer.mode);

  const scrambling = scrambleStatus === 'generating' || scrambleStatus === 'applying';
  const solving = solverStatus === 'solving';
  const playing = solverStatus === 'playing';
  const turnsBlocked =
    scrambling || solving || playing || (timerMode === 'spacebar' && ['ready', 'inspecting', 'arming'].includes(timerPhase));

  const solveLabel = solving ? (solverWarm ? 'Solving…' : 'Warming solver…') : 'Auto Solve';
  const solveTitle = solved ? 'The cube is already solved' : scrambling ? 'Wait for the scramble to finish' : 'Solve the current state';

  return (
    <section className="panel panel-actions" aria-label="Cube actions">
      <div className="panel-actions__primary">
        <Button
          variant="primary"
          size="lg"
          icon={scrambleStatus === 'generating' ? <Spinner /> : <Shuffle size={17} />}
          kbd="N"
          busy={scrambleStatus === 'generating'}
          onClick={() => requestNewScramble(services)}
          title="Reset to solved and apply a new random-state scramble"
        >
          {scrambleStatus === 'generating' ? 'Generating…' : 'New Scramble'}
        </Button>
        <Button
          variant="accent"
          size="lg"
          icon={solving ? <Spinner /> : <Sparkles size={17} />}
          kbd="A"
          busy={solving}
          disabled={solved || scrambling || solving}
          title={solveTitle}
          onClick={() => requestAutoSolve(services)}
        >
          {solveLabel}
        </Button>
        <Button variant="ghost" size="lg" icon={<RotateCcw size={16} />} onClick={() => requestReset(services)} title="Restore the solved cube">
          Reset
        </Button>
      </div>
      <div className="panel-actions__secondary" role="group" aria-label="History and camera">
        <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo || turnsBlocked} onClick={() => studio.undo()}>
          <Undo2 size={17} />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo || turnsBlocked} onClick={() => studio.redo()}>
          <Redo2 size={17} />
        </IconButton>
        <span className="divider" aria-hidden />
        <IconButton label="Reset camera (C)" onClick={() => rig.reset()}>
          <Focus size={17} />
        </IconButton>
      </div>
    </section>
  );
}
