import type { ReactNode } from 'react';
import { useServices, useStudio, useUi } from '../../app/context';
import type { Settings } from '../../core/persistence/settings';
import { Button, Dialog, Segmented, Switch } from '../ui/primitives';
import { CubeStylePicker } from './CubeStylePicker';

function Row({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__title">{title}</span>
        {description && <span className="setting__description">{description}</span>}
      </div>
      <div className="setting__control">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="setting-group">
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsDialog() {
  const { studio, ui } = useServices();
  const open = useUi((s) => s.settingsOpen);
  const settings = useStudio((s) => s.settings);
  const systemReduced = useStudio((s) => s.systemReducedMotion);
  const historyCount = useStudio((s) => s.history.length);
  const set = (patch: Partial<Settings>) => studio.updateSettings(patch);

  const changeTimer = (patch: Pick<Partial<Settings>, 'timerMode' | 'inspection'>) => {
    if (studio.attemptInProgress()) {
      ui.setState({
        confirm: {
          kind: 'mode-change',
          title: 'Change timer rules?',
          body: 'An attempt is in progress. Changing the timer mode or inspection discards it.',
          confirmLabel: 'Discard & change',
          onConfirm: () => set(patch),
        },
      });
      return;
    }
    set(patch);
  };

  return (
    <Dialog open={open} onClose={() => ui.setState({ settingsOpen: false })} eyebrow="Preferences" title="Settings" className="settings">
      <Group title="Cube">
        <div className="setting setting--stacked">
          <div className="setting__text">
            <span className="setting__title">Cube style</span>
            <span className="setting__description">Changes only the model on screen — your cube, timer and history carry on.</span>
          </div>
          <CubeStylePicker value={settings.cubeStyle} onChange={(cubeStyle) => set({ cubeStyle })} />
        </div>
        <Row title="Finish" description="Gloss or satin plastic, for either style.">
          <Segmented label="Finish" value={settings.finish} onChange={(finish) => set({ finish })} options={[{ value: 'gloss', label: 'Gloss' }, { value: 'matte', label: 'Matte' }]} />
        </Row>
        <Row title="Sticker letters" description="Prints each sticker's face letter — helpful for colour vision differences.">
          <Switch label="Sticker letters" checked={settings.faceLabels} onChange={(faceLabels) => set({ faceLabels })} />
        </Row>
        <Row title="Turn speed" description="Animation length for your own turns.">
          <Segmented
            label="Turn speed"
            size="sm"
            value={settings.turnSpeed}
            onChange={(turnSpeed) => set({ turnSpeed })}
            options={[
              { value: 'relaxed', label: 'Relaxed' },
              { value: 'normal', label: 'Normal' },
              { value: 'snappy', label: 'Snappy' },
              { value: 'instant', label: 'Instant' },
            ]}
          />
        </Row>
      </Group>

      <Group title="Timer">
        <Row title="Timer mode" description="Casual starts on your first turn. Spacebar: hold Space, release to start.">
          <Segmented
            label="Timer mode"
            value={settings.timerMode}
            onChange={(timerMode) => changeTimer({ timerMode })}
            options={[
              { value: 'casual', label: 'Casual' },
              { value: 'spacebar', label: 'Spacebar' },
            ]}
          />
        </Row>
        <Row title="15 s inspection" description="Spacebar mode only. ≥ 15 s adds +2, ≥ 17 s is DNF (training mirror of current WCA practice).">
          <Switch label="Inspection" checked={settings.inspection} disabled={settings.timerMode !== 'spacebar'} onChange={(inspection) => changeTimer({ inspection })} />
        </Row>
        <Row title="Scramble playback" description="Watch the scramble being applied, or apply it at once.">
          <Segmented
            label="Scramble playback"
            size="sm"
            value={settings.scrambleStyle}
            onChange={(scrambleStyle) => set({ scrambleStyle })}
            options={[
              { value: 'animate', label: 'Animate' },
              { value: 'instant', label: 'Instant' },
            ]}
          />
        </Row>
      </Group>

      <Group title="Controls">
        <Row title="Keyboard layout" description="Faces: U D L R F B, Shift for prime. Speed: I K J F H G D E S L W O.">
          <Segmented label="Keyboard layout" size="sm" value={settings.keyMap} onChange={(keyMap) => set({ keyMap })} options={[{ value: 'faces', label: 'Faces' }, { value: 'speed', label: 'Speed' }]} />
        </Row>
        <Row title="Single-finger drag" description="On touch screens: twist the cube, or orbit the camera.">
          <Segmented label="Single-finger drag" size="sm" value={settings.touchMode} onChange={(touchMode) => set({ touchMode })} options={[{ value: 'twist', label: 'Twist' }, { value: 'orbit', label: 'Orbit' }]} />
        </Row>
        <Row title="Orbit sensitivity" description={`${settings.orbitSensitivity.toFixed(1)}×`}>
          <input
            className="slider"
            type="range"
            min={0.4}
            max={2}
            step={0.1}
            value={settings.orbitSensitivity}
            aria-label="Orbit sensitivity"
            onChange={(e) => set({ orbitSensitivity: Number(e.target.value) })}
          />
        </Row>
      </Group>

      <Group title="Display & sound">
        <Row title="Render quality" description="Auto: soft shadows on desktop, lighter shading on touch devices, and steps down if frames drop.">
          <Segmented
            label="Render quality"
            size="sm"
            value={settings.quality}
            onChange={(quality) => set({ quality })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'high', label: 'High' },
              { value: 'low', label: 'Low' },
            ]}
          />
        </Row>
        <Row title="Motion" description={`System is currently ${systemReduced ? 'reduced' : 'full'} motion. Reduced makes turns instant.`}>
          <Segmented
            label="Motion"
            size="sm"
            value={settings.motion}
            onChange={(motion) => set({ motion })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'reduce', label: 'Reduced' },
              { value: 'full', label: 'Full' },
            ]}
          />
        </Row>
        <Row title="Sound" description="Speedcube turning sounds — sliding plastic and magnetic snaps — and a solved chime. Off by default.">
          <Switch label="Sound" checked={settings.sound} onChange={(sound) => set({ sound })} />
        </Row>
        <Row title="Volume" description={settings.sound ? `${Math.round(settings.soundVolume * 100)} %` : 'Turn sound on to adjust.'}>
          <div className="sound-controls">
            <input
              className="slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.soundVolume}
              disabled={!settings.sound}
              aria-label="Sound volume"
              onChange={(e) => set({ soundVolume: Number(e.target.value) })}
            />
            <Button size="sm" variant="quiet" disabled={!settings.sound} onClick={() => studio.previewSound()}>
              Preview
            </Button>
          </div>
        </Row>
      </Group>

      <Group title="Data">
        <Row title="Restore defaults" description="Resets every preference above. Solves are kept.">
          <Button size="sm" variant="quiet" onClick={() => studio.resetSettings()}>
            Reset settings
          </Button>
        </Row>
        <Row title="Solve history" description={`${historyCount} solve${historyCount === 1 ? '' : 's'} stored in this browser only.`}>
          <Button
            size="sm"
            variant="danger"
            disabled={historyCount === 0}
            onClick={() =>
              ui.setState({
                confirm: {
                  kind: 'clear-history',
                  title: 'Clear all solves?',
                  body: `This permanently removes ${historyCount} saved solve${historyCount === 1 ? '' : 's'} from this device.`,
                  confirmLabel: 'Clear history',
                  onConfirm: () => studio.clearHistory(),
                },
              })
            }
          >
            Clear history
          </Button>
        </Row>
      </Group>
    </Dialog>
  );
}
