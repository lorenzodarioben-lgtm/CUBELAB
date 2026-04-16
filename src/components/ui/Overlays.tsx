import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useServices, useStudio, useUi } from '../../app/context';
import { Button, Dialog } from './primitives';
import { cx } from './cx';

export function ConfirmDialog() {
  const { ui } = useServices();
  const confirm = useUi((s) => s.confirm);
  const close = () => ui.setState({ confirm: null });
  return (
    <Dialog open={confirm !== null} onClose={close} title={confirm?.title ?? ''} eyebrow="Confirm" className="confirm">
      <p className="confirm__body">{confirm?.body}</p>
      <div className="confirm__actions">
        <Button variant="quiet" onClick={close} autoFocus>
          Cancel
        </Button>
        <Button
          variant={confirm?.kind === 'clear-history' ? 'danger' : 'primary'}
          onClick={() => {
            const action = confirm?.onConfirm;
            close();
            action?.();
          }}
        >
          {confirm?.confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

const ICONS = { info: Info, success: CheckCircle2, warn: AlertTriangle, error: XCircle } as const;

export function Toast() {
  const { studio } = useServices();
  const notice = useStudio((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => studio.dismissNotice(notice.id), notice.tone === 'error' ? 6000 : 3200);
    return () => window.clearTimeout(timer);
  }, [notice, studio]);
  if (!notice) return null;
  const Icon = ICONS[notice.tone];
  return (
    <div className={cx('toast', `toast--${notice.tone}`)} role={notice.tone === 'error' ? 'alert' : 'status'} key={notice.id}>
      <Icon size={16} aria-hidden />
      <span>{notice.text}</span>
    </div>
  );
}

/** Transient guidance near the cube (blocked turns, gesture tips). */
export function StageHint() {
  const hint = useStudio((s) => s.hint);
  if (!hint) return null;
  // Keyed by id so each hint remounts and replays its fade-in / hold / fade-out animation.
  return (
    <div className="stage-hint" role="status" aria-live="polite" key={hint.id}>
      {hint.text}
    </div>
  );
}

/** Screen-reader announcements for solved / scramble / solver events. */
export function LiveRegion() {
  const announcement = useStudio((s) => s.announcement);
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  );
}
