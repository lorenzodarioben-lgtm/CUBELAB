import { useMemo, useState } from 'react';
import { Copy, Download, Trash2 } from 'lucide-react';
import { useServices, useStudio, useUi } from '../../app/context';
import { copyText } from '../../app/clipboard';
import { effectiveMs } from '../../core/stats/stats';
import { formatTime, formatTps } from '../../core/stats/format';
import type { SolveRecord } from '../../core/persistence/storage';
import { Button, Dialog, IconButton } from '../ui/primitives';
import { cx } from '../ui/cx';

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function csvEscape(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv(records: readonly SolveRecord[]): void {
  const header = ['index', 'date', 'raw_ms', 'penalty', 'effective_ms', 'assisted', 'mode', 'inspection_ms', 'turns_htm', 'turns_qtm', 'scramble', 'note'];
  const rows = records.map((r, i) => {
    const eff = effectiveMs(r);
    return [
      i + 1,
      new Date(r.timestamp).toISOString(),
      r.durationMs.toFixed(1),
      r.penalty,
      Number.isFinite(eff) ? eff.toFixed(1) : 'DNF',
      r.assisted ? 'yes' : 'no',
      r.mode,
      r.inspectionMs === null ? null : r.inspectionMs.toFixed(0),
      r.turnsHTM,
      r.turnsQTM,
      r.scramble,
      r.note,
    ]
      .map(csvEscape)
      .join(',');
  });
  const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cubelab-solves-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SolveRow({ record, index }: { record: SolveRecord; index: number }) {
  const { studio } = useServices();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const eff = effectiveMs(record);
  const tps = formatTps(record.turnsHTM, record.durationMs);

  return (
    <li className={cx('solve', open && 'is-open', record.assisted && 'is-practice')}>
      <button type="button" className="solve__summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="solve__index">{index}</span>
        <span className="solve__time">
          {record.penalty === 'DNF' ? (
            <>
              DNF <span className="solve__raw">({formatTime(record.durationMs)})</span>
            </>
          ) : (
            formatTime(eff)
          )}
        </span>
        <span className="solve__tags">
          {record.penalty === '+2' && <span className="tag tag--warn">+2</span>}
          {record.penalty === 'DNF' && <span className="tag tag--danger">DNF</span>}
          {record.assisted && <span className="tag">Practice</span>}
        </span>
        <span className="solve__date">{dateFormat.format(record.timestamp)}</span>
      </button>
      {open && (
        <div className="solve__detail">
          <dl className="solve__facts">
            <div>
              <dt>Raw time</dt>
              <dd>{formatTime(record.durationMs)}</dd>
            </div>
            <div>
              <dt>Turns</dt>
              <dd>
                {record.turnsHTM} HTM · {record.turnsQTM} QTM
              </dd>
            </div>
            <div>
              <dt>TPS</dt>
              <dd>{tps ?? '—'}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>
                {record.mode === 'spacebar' ? 'Spacebar' : 'Casual'}
                {record.inspectionMs !== null && ` · insp. ${(record.inspectionMs / 1000).toFixed(1)} s`}
              </dd>
            </div>
          </dl>
          {record.note && <p className="muted">{record.note === 'inspection-timeout' ? 'Inspection exceeded 17 s.' : 'Timer stopped before the cube was solved.'}</p>}
          {record.assisted && <p className="muted">Undo or redo was used — kept as practice, excluded from PB and averages.</p>}
          {record.scramble && (
            <div className="solve__scramble">
              <code>{record.scramble}</code>
              <IconButton
                label="Copy scramble"
                size="sm"
                onClick={() => void copyText(record.scramble).then((ok) => studio.notify(ok ? 'success' : 'warn', ok ? 'Scramble copied' : 'Clipboard unavailable'))}
              >
                <Copy size={14} />
              </IconButton>
            </div>
          )}
          <div className="solve__actions">
            {confirming ? (
              <>
                <span className="muted">Delete this solve?</span>
                <Button size="sm" variant="danger" onClick={() => studio.deleteSolve(record.id)}>
                  Delete
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button size="sm" variant="quiet" icon={<Trash2 size={14} />} onClick={() => setConfirming(true)}>
                Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function HistoryDrawer() {
  const { studio, ui } = useServices();
  const open = useUi((s) => s.historyOpen);
  const history = useStudio((s) => s.history);
  const ordered = useMemo(() => history.map((r, i) => ({ record: r, index: i + 1 })).reverse(), [history]);
  const close = () => ui.setState({ historyOpen: false });

  return (
    <Dialog
      open={open}
      onClose={close}
      variant="sheet"
      eyebrow="Saved on this device"
      title="Solve history"
      className="history"
      actions={
        history.length > 0 ? (
          <>
            <IconButton label="Export CSV" size="sm" onClick={() => exportCsv(history)}>
              <Download size={15} />
            </IconButton>
            <IconButton
              label="Clear all solves"
              size="sm"
              onClick={() =>
                ui.setState({
                  confirm: {
                    kind: 'clear-history',
                    title: 'Clear all solves?',
                    body: `This permanently removes ${history.length} saved solve${history.length === 1 ? '' : 's'} from this device.`,
                    confirmLabel: 'Clear history',
                    onConfirm: () => studio.clearHistory(),
                  },
                })
              }
            >
              <Trash2 size={15} />
            </IconButton>
          </>
        ) : null
      }
    >
      {history.length === 0 ? (
        <div className="panel__empty panel__empty--center">
          <p className="serif-lg">Nothing here yet.</p>
          <p>Every timed attempt lands here — singles, +2s, DNFs and practice runs — stored only in this browser.</p>
        </div>
      ) : (
        <ol className="solve-list">
          {ordered.map(({ record, index }) => (
            <SolveRow key={record.id} record={record} index={index} />
          ))}
        </ol>
      )}
    </Dialog>
  );
}
