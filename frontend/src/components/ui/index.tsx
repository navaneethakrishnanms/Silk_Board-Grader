/** Small shadcn-style primitives on CSS tokens (neutral chrome). */
import { forwardRef, useEffect, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2, X } from 'lucide-react';
import { cn, useToasts } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90',
  secondary: 'bg-[var(--surface-2)] text-[var(--text)] hover:brightness-95 dark:hover:brightness-125',
  outline: 'border border-[var(--border)] bg-transparent hover:bg-[var(--surface-2)]',
  ghost: 'bg-transparent hover:bg-[var(--surface-2)]',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...p }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-sm' : size === 'lg' ? 'h-11 px-5 text-base' : 'h-9 px-4 text-sm',
        VARIANT[variant],
        className,
      )}
      {...p}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn('surface rounded-xl', className)} {...p} />;
export const CardHeader = ({ title, actions, subtitle }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      {subtitle && <p className="muted text-xs">{subtitle}</p>}
    </div>
    {actions}
  </div>
);

export const Label = ({ className, ...p }: HTMLAttributes<HTMLLabelElement> & { htmlFor?: string }) => (
  <label className={cn('mb-1 block text-xs font-medium muted', className)} {...p} />
);

const field = 'h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--focus)]';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, className)} {...p} />
));
Input.displayName = 'Input';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(field, 'pr-8', className)} {...p} />
));
Select.displayName = 'Select';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(field, 'h-auto min-h-20 py-2', className)} {...p} />
));
Textarea.displayName = 'Textarea';

export function Field({ label, htmlFor, children, hint, className }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', disabled && 'opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-5 w-9 rounded-full transition', checked ? 'bg-[var(--accent)]' : 'bg-[var(--border)]')}
      >
        <span className={cn('absolute top-0.5 size-4 rounded-full bg-[var(--surface)] shadow transition', checked ? 'left-4.5' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}

export function Segmented<T extends string | number>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-md border border-[var(--border)] p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded px-3 py-1 text-sm', value === o.value ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'hover:bg-[var(--surface-2)]')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-[var(--border)]">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm', value === t.value ? 'border-[var(--accent)] font-medium' : 'border-transparent muted hover:text-[var(--text)]')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, className, tone = 'neutral' }: { children: ReactNode; className?: string; tone?: 'neutral' | 'amber' | 'violet' | 'green' | 'red' | 'slate' | 'blue' }) {
  const tones = {
    neutral: 'bg-[var(--surface-2)] text-[var(--text)]',
    slate: 'border border-slate-400 text-slate-600 dark:text-slate-300',
    amber: 'bg-amber-600 text-white',
    violet: 'border border-violet-500 text-violet-700 dark:text-violet-300',
    green: 'bg-green-600 text-white',
    red: 'bg-red-600 text-white',
    blue: 'bg-blue-600 text-white',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn('size-5 animate-spin muted', className)} aria-label="Loading" />;

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="muted text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted rounded-lg border border-dashed border-[var(--border)] p-8 text-center text-sm">{children}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error instanceof Error ? error.message : String(error)}</div>;
}

export function Drawer({ open, onClose, title, children, side = 'right' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; side?: 'right' | 'bottom' }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={cn('surface absolute overflow-y-auto p-5 shadow-xl', side === 'right' ? 'right-0 top-0 h-full w-full max-w-lg' : 'bottom-0 left-0 max-h-[85vh] w-full rounded-t-xl')}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="size-4" /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[60] flex flex-col gap-2 md:bottom-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn('pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg',
            t.kind === 'error' ? 'bg-red-600 text-white' : t.kind === 'ok' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-blue-600 text-white')}
        >
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss"><X className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm">{children}</table></div>;
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={cn('border-b border-[var(--border)] px-3 py-2 text-xs font-medium muted', className)}>{children}</th>
);
export const Td = ({ children, className, ...p }: HTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('border-b border-[var(--border)] px-3 py-2', className)} {...p}>{children}</td>
);
