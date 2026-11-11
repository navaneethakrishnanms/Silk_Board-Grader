/** Grade card (S10) + expert review controls (S12). */
import { Fragment, useState } from 'react';
import { ChevronDown, EyeOff } from 'lucide-react';
import { GRADE_CODE, GRADE_KIND_LABEL, GRADES, gradeLabel, REVIEW_REASON_LABEL, type GradeDTO, type GradeFeatures } from '@silkgrade/shared';
import { Badge, Button, Card, Select, Textarea } from '@/components/ui';
import { cn, fmt, fmtDateTime, labToHex } from '@/lib/utils';
import { DecisionBadges, GradeChip, GradeScale, PassBadge } from './GradeBits';

export function Measurements({ f }: { f: GradeFeatures | null }) {
  const [open, setOpen] = useState(false);
  if (!f) return null;
  const dir = (v: number | undefined, pos: string, neg: string) => (v === undefined ? '' : Math.abs(v) < 0.05 ? '' : v > 0 ? pos : neg);
  const rows: [string, string][] = [
    ['ΔE*ab', fmt(f.dE_ab)],
    ['ΔE00', fmt(f.dE00)],
    ...(f.dE_F !== undefined ? [['ΔE_F' + (f.dE_F_is_placeholder ? ' (placeholder)' : ''), fmt(f.dE_F)] as [string, string]] : []),
    ['ΔL*', `${fmt(f.dL)} ${dir(f.dL, 'lighter', 'darker')}`],
    ['ΔC*', `${fmt(f.dC)} ${dir(f.dC, 'brighter', 'duller')}`],
    ['ΔH*', fmt(f.dH)],
    ['p50 / p90', `${fmt(f.p50)} / ${fmt(f.p90)}`],
    ['Area share', f.area_share !== undefined ? `${Math.round(f.area_share * 100)}%` : '—'],
  ];
  return (
    <div className="border-t border-[var(--border)]">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="muted flex w-full items-center justify-between px-4 py-2 text-xs font-medium">
        Measurements <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 px-4 pb-3 text-xs">
          {rows.map(([k, v]) => (<Fragment key={k}><dt className="muted">{k}</dt><dd>{v}</dd></Fragment>))}
        </dl>
      )}
    </div>
  );
}

function Swatches({ f }: { f: GradeFeatures | null }) {
  const b = (f?.swatch_before ?? f?.lab_before) as number[] | undefined;
  const a = (f?.swatch_after ?? f?.lab_after) as number[] | undefined;
  if (!b || !a) return null;
  return (
    <span className="inline-flex overflow-hidden rounded border border-[var(--border)]" title="Before / after colour">
      <span className="size-5" style={{ background: labToHex(b) }} />
      <span className="size-5" style={{ background: labToHex(a) }} />
    </span>
  );
}

export function ReviewControls({ g, onSubmit, blind }: { g: GradeDTO; onSubmit: (half: number, reason?: string) => Promise<unknown>; blind: boolean }) {
  const [mode, setMode] = useState<'idle' | 'override'>(blind ? 'override' : 'idle');
  const [half, setHalf] = useState<number>(g.halfGrade ?? 4);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (h: number, r?: string) => { setBusy(true); try { await onSubmit(h, r); setMode(blind ? 'override' : 'idle'); setReason(''); } finally { setBusy(false); } };
  if (mode === 'idle') {
    return (
      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] px-4 py-3">
        <Button size="sm" loading={busy} onClick={() => run(g.halfGrade!)}>Accept {gradeLabel(g.halfGrade)}</Button>
        <Button size="sm" variant="outline" onClick={() => setMode('override')}>Override</Button>
      </div>
    );
  }
  const needReason = !blind && half !== g.halfGrade;
  return (
    <div className="space-y-2 border-t border-[var(--border)] px-4 py-3">
      <div className="flex items-center gap-2">
        <label className="text-sm" htmlFor={`h-${g.id}`}>{blind ? 'Your grade' : 'Expert grade'}</label>
        <Select id={`h-${g.id}`} className="w-24" value={half} onChange={(e) => setHalf(Number(e.target.value))}>
          {[...GRADES].reverse().map((x) => <option key={x} value={x}>{gradeLabel(x)}</option>)}
        </Select>
      </div>
      <Textarea rows={2} placeholder={needReason ? 'Reason (required for an override)' : 'Note (optional)'} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" loading={busy} disabled={needReason && !reason.trim()} onClick={() => run(half, reason || undefined)}>{blind ? 'Submit blind grade' : 'Save override'}</Button>
        {!blind && <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>Cancel</Button>}
      </div>
    </div>
  );
}

export function GradeCard({ g, required, reviewable, onReview, blind, compact }: {
  g: GradeDTO; required: number | null; reviewable?: boolean; onReview?: (half: number, reason?: string) => Promise<unknown>; blind?: boolean; compact?: boolean;
}) {
  const reasons = (g.features?.review_reasons ?? []) as string[];
  return (
    <Card className={cn(compact && 'shadow-none')}>
      <div className="flex flex-wrap items-start gap-3 p-4">
        {g.hidden ? (
          <div className="flex h-14 min-w-16 items-center justify-center rounded-md bg-[var(--surface-2)]"><EyeOff className="size-5 muted" aria-label="Hidden" /></div>
        ) : (
          <GradeChip grade={g.effectiveGrade ?? g.halfGrade} size={compact ? 'md' : 'lg'} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num muted text-xs">{GRADE_CODE[g.kind]}</span>
            <span className="text-sm font-semibold">{GRADE_KIND_LABEL[g.kind]}</span>
            {g.label && <span className="muted text-sm">— {g.label}</span>}
            {g.kind.startsWith('CHANGE_') && <Swatches f={g.features} />}
          </div>
          {g.hidden ? (
            <p className="muted mt-1 text-sm">Grades hidden — blind labelling</p>
          ) : (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span className="num">rating {fmt(g.finalRating)}</span>
                <span className="num muted">CI {fmt(g.ciLow)}–{fmt(g.ciHigh)}</span>
                <Badge>{g.confidence} confidence</Badge>
                <DecisionBadges g={g} />
                <PassBadge pass={g.effectivePass} />
                {required !== null && <span className="muted text-xs">required {gradeLabel(required)}</span>}
              </div>
              {g.effectiveGrade !== null && g.effectiveGrade !== g.halfGrade && (
                <p className="mt-1 text-xs">App grade {gradeLabel(g.halfGrade)} → expert grade <b>{gradeLabel(g.effectiveGrade)}</b></p>
              )}
              {!compact && <div className="mt-3"><GradeScale rating={g.finalRating} ciLow={g.ciLow} ciHigh={g.ciHigh} /></div>}
              {reasons.length > 0 && g.decision === 'REVIEW' && (
                <p className="muted mt-2 text-xs">Review: {reasons.map((r) => REVIEW_REASON_LABEL[r] ?? r).join(' · ')}</p>
              )}
            </>
          )}
          {g.expertGrades.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {g.expertGrades.map((e) => (
                <li key={e.id}><b>{e.userName ?? 'Expert'}</b>: {gradeLabel(e.halfGrade)}{e.blind ? ' (blind)' : ''}{e.reason ? ` — ${e.reason}` : ''} <span className="muted">{fmtDateTime(e.createdAt)}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {!g.hidden && !compact && <Measurements f={g.features} />}
      {reviewable && onReview && <ReviewControls g={g} onSubmit={onReview} blind={!!blind} />}
    </Card>
  );
}
