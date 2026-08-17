import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import type { Classification } from '../types';
import { CLASSIFICATION_LABELS } from '../types';

export function Panel({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'aside';
}) {
  return (
    <Tag
      className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] [box-shadow:var(--shadow-card)] ${className}`}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line-soft)] px-5 py-4">
      <div className="min-w-0">
        <h2 className="font-display text-[18px] leading-tight text-[var(--ink)]">{title}</h2>
        {description && <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-[var(--ink-mute)]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-ink)] border-transparent hover:brightness-110 active:brightness-95 shadow-sm',
  secondary:
    'bg-transparent text-[var(--ink)] border-[var(--line)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
  ghost: 'bg-transparent text-[var(--ink-soft)] border-transparent hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]',
  danger: 'bg-transparent text-[var(--data-haram)] border-[var(--line)] hover:border-[var(--data-haram)]',
};

export function Button({
  variant = 'secondary',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium
        transition-all duration-200 ease-[var(--ease-out-expo)]
        disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100
        ${BUTTON_STYLES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

const FIELD_BASE =
  'w-full rounded-lg border border-[var(--line)] bg-[var(--ground)] px-3 py-2 text-[13.5px] text-[var(--ink)] ' +
  'transition-colors duration-200 placeholder:text-[var(--ink-mute)] focus:border-[var(--accent)] focus:outline-none';

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--ink-mute)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] leading-snug text-[var(--ink-mute)]">{hint}</span>}
    </label>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`${FIELD_BASE} ${rest.type === 'number' ? 'tnum' : ''} ${className}`} />;
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`${FIELD_BASE} cursor-pointer ${className}`}>
      {children}
    </select>
  );
}

export function MoneyInput({
  cents,
  onCents,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  cents: number;
  onCents: (cents: number) => void;
}) {
  return (
    <Input
      {...rest}
      type="number"
      step="0.01"
      inputMode="decimal"
      value={cents === 0 ? '' : (cents / 100).toString()}
      placeholder="0.00"
      onChange={(e) => {
        const v = e.target.value;
        if (v === '') return onCents(0);
        const n = Number(v);
        onCents(Number.isFinite(n) ? Math.round(n * 100) : 0);
      }}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2.5 text-left"
    >
      <span
        className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-300 ease-[var(--ease-out-expo)] ${
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--line)]'
        }`}
      >
        <span
          className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all duration-300 ease-[var(--ease-spring)] ${
            checked ? 'left-[19px]' : 'left-[3px]'
          }`}
        />
      </span>
      <span className="text-[13px] text-[var(--ink-soft)]">{label}</span>
    </button>
  );
}

const GLYPH: Partial<Record<Classification, string>> = {
  haram: '!',
  tentative: '?',
  missing_information: '–',
};

export function StatusBadge({ status, className = '' }: { status: Classification; className?: string }) {
  const token = status === 'missing_information' || status === 'excluded' ? 'unknown' : status;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11px] font-medium ${className}`}
      style={{
        color: `var(--data-${token})`,
        borderColor: `color-mix(in oklab, var(--data-${token}) 40%, transparent)`,
        background: `color-mix(in oklab, var(--data-${token}) 10%, transparent)`,
      }}
    >
      {GLYPH[status] && (
        <span aria-hidden className="font-mono text-[10px] leading-none opacity-80">
          {GLYPH[status]}
        </span>
      )}
      {CLASSIFICATION_LABELS[status]}
    </span>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'critical';
  title?: string;
  children: ReactNode;
}) {
  const token = tone === 'critical' ? 'haram' : tone === 'warning' ? 'mixed' : 'tentative';
  return (
    <div
      className="animate-rise rounded-xl border px-4 py-3"
      style={{
        borderColor: `color-mix(in oklab, var(--data-${token}) 34%, transparent)`,
        background: `color-mix(in oklab, var(--data-${token}) 8%, transparent)`,
      }}
    >
      {title && (
        <p className="text-[13.5px] font-semibold" style={{ color: `var(--data-${token})` }}>
          {title}
        </p>
      )}
      <div className="text-[13px] leading-relaxed text-[var(--ink-soft)]">{children}</div>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Classification | 'accent';
  emphasis?: boolean;
}) {
  const color =
    tone === 'accent'
      ? 'var(--accent)'
      : tone
        ? `var(--data-${tone === 'missing_information' || tone === 'excluded' ? 'unknown' : tone})`
        : 'var(--ink)';
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-mute)]">{label}</p>
      <p
        className={`mt-1 font-display leading-none ${emphasis ? 'text-[30px]' : 'text-[21px]'}`}
        style={{ color }}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ink-mute)]">{sub}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="animate-rise flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line)] px-6 py-14 text-center">
      <div
        aria-hidden
        className="mb-4 h-10 w-10 rounded-full border border-[var(--line)]"
        style={{ background: 'color-mix(in oklab, var(--accent) 12%, transparent)' }}
      />
      <h3 className="font-display text-[17px] text-[var(--ink)]">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[var(--ink-mute)]">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
