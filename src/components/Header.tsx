import { CircleHelp, Maximize2, Minimize2, Settings2, Volume2, VolumeX } from 'lucide-react';
import { useServices, useStudio, useUi } from '../app/context';
import { toggleZen } from '../app/actions';
import { LogoMark } from './ui/Logo';
import { IconButton, Segmented } from './ui/primitives';

export function Header() {
  const services = useServices();
  const { studio, ui } = services;
  const zen = useUi((s) => s.zen);
  const sound = useStudio((s) => s.settings.sound);
  const timerMode = useStudio((s) => s.settings.timerMode);

  const setMode = (mode: 'casual' | 'spacebar') => {
    if (mode === timerMode) return;
    if (studio.attemptInProgress()) {
      ui.setState({
        confirm: {
          kind: 'mode-change',
          title: 'Change timer mode?',
          body: 'An attempt is in progress. Switching the timer mode discards it.',
          confirmLabel: 'Discard & switch',
          onConfirm: () => studio.updateSettings({ timerMode: mode }),
        },
      });
      return;
    }
    studio.updateSettings({ timerMode: mode });
  };

  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="CUBELAB home" onClick={(e) => e.preventDefault()}>
        <LogoMark size={30} />
        <span className="brand__word">CUBELAB</span>
        <span className="brand__rule" aria-hidden />
        <span className="brand__meta">
          Studio <span aria-hidden>/</span> 3×3×3
        </span>
      </a>
      <p className="topbar__tagline">The interactive cubing studio.</p>
      <nav className="topbar__actions" aria-label="Studio controls">
        <Segmented
          className="topbar__mode"
          label="Timer mode"
          size="sm"
          value={timerMode}
          onChange={setMode}
          options={[
            { value: 'casual', label: 'Casual', title: 'Clock starts on your first turn' },
            { value: 'spacebar', label: 'Spacebar', title: 'Hold and release Space to start' },
          ]}
        />
        <IconButton
          label={sound ? 'Mute sound' : 'Enable sound'}
          active={sound}
          className="topbar__sound"
          onClick={() => studio.updateSettings({ sound: !sound })}
        >
          {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
        </IconButton>
        <IconButton label="Help & shortcuts (?)" onClick={() => ui.setState({ helpOpen: true })}>
          <CircleHelp size={17} />
        </IconButton>
        <IconButton label="Settings" onClick={() => ui.setState({ settingsOpen: true })}>
          <Settings2 size={17} />
        </IconButton>
        <IconButton label={zen ? 'Exit zen mode (`)' : 'Zen mode (`)'} active={zen} onClick={() => toggleZen(services)} className="topbar__zen">
          {zen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </IconButton>
      </nav>
    </header>
  );
}
