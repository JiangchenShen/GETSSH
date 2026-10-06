import type { ReactNode } from 'react';

export const settingFieldClass = 'min-h-9 w-full rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-ink outline-none transition-colors focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50';
export const settingButtonClass = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surf hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40';
export const settingDangerButtonClass = `${settingButtonClass} text-down hover:border-down/40 hover:bg-down/10 hover:text-down`;

export function SettingsSection({ title, description, children, className = '' }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-2">
        <h3 className="text-xs font-semibold text-ink-2">{title}</h3>
        {description && <p className="mt-1 text-xs leading-relaxed text-ink-3">{description}</p>}
      </div>
      <div className="border-y border-line-soft">{children}</div>
    </section>
  );
}

export function SettingsRow({ label, description, children, stacked = false }: { label: string; description?: string; children?: ReactNode; stacked?: boolean }) {
  return (
    <div className={`settings-row gap-3 border-b border-line-soft px-1 py-3 last:border-b-0 ${stacked ? 'flex flex-col' : 'flex flex-col sm:flex-row sm:items-center sm:justify-between'}`}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{description}</p>}
      </div>
      {children && <div className={`settings-row-control min-w-0 shrink-0 ${stacked ? 'w-full' : 'sm:max-w-[54%]'}`}>{children}</div>}
    </div>
  );
}

export function SettingsToggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'border-primary bg-primary' : 'border-line bg-surf-2'}`}
    >
      <span className={`absolute top-[3px] left-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}
