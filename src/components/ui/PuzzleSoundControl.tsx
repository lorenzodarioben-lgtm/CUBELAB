import { useServices, useStudio } from '../../app/context';
import { Button } from './primitives';

export function PuzzleSoundControl() {
  const { studio } = useServices();
  const sound = useStudio((state) => state.settings.sound);
  const volume = useStudio((state) => state.settings.soundVolume);
  return <div className="puzzle-sound">
    <div className="puzzle-sound__head"><span>Turn sound</span><output>{Math.round(volume * 100)}%</output></div>
    <div className="puzzle-sound__row">
      <input type="range" min="0" max="1" step="0.05" value={volume} disabled={!sound} aria-label="Turn sound volume" onChange={(event) => studio.updateSettings({ soundVolume: Number(event.target.value) })} />
      <Button variant="quiet" size="sm" disabled={!sound} onClick={() => studio.previewSound()}>Preview</Button>
    </div>
    {!sound && <small>Enable sound in the top bar to adjust.</small>}
  </div>;
}
