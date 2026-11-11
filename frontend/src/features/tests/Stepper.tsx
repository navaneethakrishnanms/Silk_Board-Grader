import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const STEPS = ['Details', 'Before-wash images', 'Confirm regions', 'After-wash images', 'Regions & alignment', 'Result'];

export function Stepper({ current }: { current: number }) {
  return (
    <ol className="mb-5 flex gap-1 overflow-x-auto pb-1" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === current ? 'step' : undefined} className="flex shrink-0 items-center gap-1.5 text-xs">
          <span className={cn('flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold',
            i < current ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]' : i === current ? 'border-[var(--accent)]' : 'border-[var(--border)] muted')}>
            {i < current ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn(i === current ? 'font-medium' : 'muted', 'hidden sm:inline')}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 hidden h-px w-6 bg-[var(--border)] sm:inline-block" />}
        </li>
      ))}
    </ol>
  );
}
