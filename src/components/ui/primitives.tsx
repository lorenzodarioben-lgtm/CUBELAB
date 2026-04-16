import { useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';


type Variant = 'primary' | 'accent' | 'ghost' | 'quiet' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly icon?: ReactNode;
  readonly kbd?: string;
  readonly size?: 'md' | 'lg' | 'sm';
  readonly busy?: boolean;
}

export function Button({ variant = 'ghost', icon, kbd, size = 'md', busy, className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={cx('btn', `btn--${variant}`, `btn--${size}`, busy && 'is-busy', className)} aria-busy={busy || undefined} {...rest}>
      {icon && <span className="btn__icon" aria-hidden>{icon}</span>}
      {children && <span className="btn__label">{children}</span>}
      {kbd && (
        <kbd className="btn__kbd" aria-hidden>
          {kbd}
        </kbd>
      )}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly label: string;
  readonly active?: boolean;
  readonly size?: 'sm' | 'md';
}

export function IconButton({ label, active, size = 'md', className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={cx('icon-btn', `icon-btn--${size}`, active && 'is-active', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}

interface SegmentedProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: ReactNode; readonly title?: string }>;
  readonly onChange: (value: T) => void;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
  readonly disabled?: boolean;
}

/** Radio-group semantics with roving arrow-key focus. */
export function Segmented<T extends string>({ label, value, options, onChange, size = 'md', className, disabled }: SegmentedProps<T>) {
  const name = useId();
  return (
    <div className={cx('segmented', `segmented--${size}`, className)} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className={cx('segmented__option', option.value === value && 'is-selected')} title={option.title}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

interface SwitchProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}

export function Switch({ label, checked, onChange, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx('switch', checked && 'is-on')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__thumb" />
    </button>
  );
}

interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly eyebrow?: string;
  readonly children: ReactNode;
  readonly variant?: 'center' | 'sheet';
  readonly className?: string;
  readonly actions?: ReactNode;
}

/** Native <dialog>: real modality, focus containment and Esc-to-close for free. */
export function Dialog({ open, onClose, title, eyebrow, children, variant = 'center', className, actions }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx('dialog', `dialog--${variant}`, className)}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog__surface">
          <header className="dialog__header">
            <div>
              {eyebrow && <p className="eyebrow">{eyebrow}</p>}
              <h2 id={titleId} className="dialog__title">
                {title}
              </h2>
            </div>
            <div className="dialog__header-actions">
              {actions}
              <IconButton label="Close" onClick={onClose} size="sm">
                <X size={16} />
              </IconButton>
            </div>
          </header>
          <div className="dialog__body">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />;
}
