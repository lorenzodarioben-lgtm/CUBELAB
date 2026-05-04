/**
 * Global keyboard handling. Ignored while typing in form fields or when a
 * dialog is open (dialogs handle their own Esc). In Spacebar mode the Space
 * key belongs to the timer during an attempt — even if a button has focus —
 * so a focused button can never be "clicked" by the timer key.
 */
import { useEffect } from 'react';
import type { AppServices } from '../app/context';
import { requestAutoSolve, requestNewScramble, toggleZen } from '../app/actions';
import { moveForKey } from './keymap';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['radio', 'checkbox', 'range', 'button'].includes(target.type);
  }
  return false;
}

function inComposite(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('[role="radiogroup"], input[type="range"]'));
}

export function useKeyboard(services: AppServices, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const { studio, ui, rig } = services;
    const timerOwnsSpace = () => {
      const t = studio.state.timer;
      return t.mode === 'spacebar' && ['ready', 'inspecting', 'arming', 'running'].includes(t.phase);
    };
    const dialogOpen = () => {
      const s = ui.getState();
      return s.helpOpen || s.settingsOpen || s.historyOpen || s.confirm !== null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (dialogOpen() || isTypingTarget(e.target)) return;

      if (e.code === 'Space') {
        if (studio.state.timer.mode !== 'spacebar') return;
        if (!timerOwnsSpace() && e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        if (!e.repeat) studio.spaceDown(e.timeStamp);
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) studio.redo();
        else studio.undo();
        return;
      }
      if (mod && e.code === 'KeyY') {
        e.preventDefault();
        studio.redo();
        return;
      }
      if (mod || e.altKey) return;

      if (e.key === 'Escape') {
        if (studio.state.timer.phase === 'arming') studio.cancelArming();
        else if (ui.getState().zen) toggleZen(services, false);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        ui.setState({ helpOpen: true });
        return;
      }

      if (e.key.startsWith('Arrow') && !inComposite(e.target)) {
        e.preventDefault();
        const step = e.shiftKey ? 0.32 : 0.16;
        if (e.key === 'ArrowLeft') rig.nudge(-step, 0);
        if (e.key === 'ArrowRight') rig.nudge(step, 0);
        if (e.key === 'ArrowUp') rig.nudge(0, -step);
        if (e.key === 'ArrowDown') rig.nudge(0, step);
        return;
      }

      const move = moveForKey(e, studio.state.settings.keyMap);
      if (move) {
        e.preventDefault();
        if (!e.repeat) studio.turn(move);
        return;
      }

      if (e.repeat) return;
      switch (e.code) {
        case 'KeyN':
          requestNewScramble(services);
          break;
        case 'KeyA':
          if (!studio.state.solved) requestAutoSolve(services);
          else studio.hint('The cube is already solved');
          break;
        case 'KeyP': {
          const status = studio.state.solver.status;
          if (status === 'playing') studio.playbackPause();
          else studio.playbackPlay();
          break;
        }
        case 'Comma':
          studio.playbackStep(-1);
          break;
        case 'Period':
          studio.playbackStep(1);
          break;
        case 'KeyC':
          rig.reset();
          break;
        case 'Backquote':
          toggleZen(services);
          break;
        default:
          return;
      }
      e.preventDefault();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || studio.state.timer.mode !== 'spacebar') return;
      if (dialogOpen() || isTypingTarget(e.target)) return;
      if (!timerOwnsSpace() && studio.state.timer.phase !== 'running' && e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      studio.spaceUp(e.timeStamp);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [services, enabled]);
}
