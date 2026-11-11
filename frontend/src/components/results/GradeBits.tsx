/** Grade chip, decision badges, grey-scale strip with CI, status badge. */
import { gradeLabel, gradeTone, STATUS_LABEL, type GradeDTO, type TestStatus } from '@silkgrade/shared';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

const TONE: Record<string, string> = {
  green: 'bg-green-600 text-white',
  lime: 'bg-lime-600 text-white',
  amber: 'bg-amber-600 text-white',
  orange: 'bg-orange-600 text-white',
  red: 'bg-red-600 text-white',
};

export function GradeChip({ grade, size = 'md', className }: { grade: number | null | undefined; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  if (grade === null || grade === undefined) {
    return <span className={cn('num inline-flex items-center justify-center rounded-md bg-[var(--surface-2)] muted', size === 'lg' ? 'h-14 min-w-16 px-3 text-2xl' : size === 'sm' ? 'h-6 min-w-9 px-1.5 text-xs' : 'h-8 min-w-11 px-2 text-sm', className)}>—</span>;
  }
  return (
    <span
      aria-label={`Grade ${gradeLabel(grade)}`}
      className={cn('num inline-flex items-center justify-center rounded-md font-semibold', TONE[gradeTone(grade)],
        size === 'lg' ? 'h-14 min-w-16 px-3 text-2xl' : size === 'sm' ? 'h-6 min-w-9 px-1.5 text-xs' : 'h-8 min-w-11 px-2 text-sm', className)}
    >
      {gradeLabel(grade)}
    </span>
  );
}

export function PassBadge({ pass }: { pass: boolean | null | undefined }) {
  if (pass === null || pass === undefined) return <Badge>No limit</Badge>;
  return pass ? <Badge tone="green">Pass</Badge> : <Badge tone="red">Fail</Badge>;
}

export function DecisionBadges({ g }: { g: GradeDTO }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {g.decision === 'AUTO' && <Badge tone="slate">Auto-accepted</Badge>}
      {g.decision === 'REVIEW' && !g.reviewed && <Badge tone="amber">Needs review</Badge>}
      {g.decision === 'REVIEW' && g.reviewed && <Badge tone="slate">Reviewed</Badge>}
      {g.features?.dE_F_is_placeholder && <Badge tone="violet" className="" >Provisional</Badge>}
    </span>
  );
}

export function StatusBadge({ status }: { status: TestStatus }) {
  const tone = status === 'NEEDS_REVIEW' ? 'amber' : status === 'COMPLETED' ? 'green' : status === 'VOID' ? 'red' : status === 'GRADING' ? 'blue' : 'neutral';
  return <Badge tone={tone}>{STATUS_LABEL[status]}</Badge>;
}

/** 1–5 grey-scale strip (5 = white, 1 = dark) with the continuous rating and its CI. */
export function GradeScale({ rating, ciLow, ciHigh }: { rating: number | null; ciLow: number | null; ciHigh: number | null }) {
  const pos = (v: number) => `${((v - 1) / 4) * 100}%`;
  const steps = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  return (
    <div className="w-full" aria-label={rating !== null ? `Rating ${rating.toFixed(2)}, interval ${ciLow?.toFixed(2)} to ${ciHigh?.toFixed(2)}` : 'Rating hidden'}>
      <div className="relative h-6 overflow-hidden rounded" style={{ background: 'linear-gradient(90deg,#3a3a3a,#f4f4f4)' }}>
        {steps.map((s) => (
          <span key={s} className="absolute top-0 h-full w-px bg-black/20" style={{ left: pos(s) }} />
        ))}
        {rating !== null && ciLow !== null && ciHigh !== null && (
          <>
            <span className="absolute top-1 h-4 rounded bg-blue-500/40 ring-1 ring-blue-600" style={{ left: pos(ciLow), width: `calc(${pos(ciHigh)} - ${pos(ciLow)})`, minWidth: 3 }} />
            <span className="absolute top-0 h-full w-0.5 bg-blue-700" style={{ left: pos(rating) }} />
          </>
        )}
      </div>
      <div className="num muted mt-0.5 flex justify-between text-[10px]">
        {[1, 2, 3, 4, 5].map((s) => <span key={s}>{s}</span>)}
      </div>
    </div>
  );
}
