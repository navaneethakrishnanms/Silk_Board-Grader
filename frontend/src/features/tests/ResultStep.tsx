/** S9 grading progress · S10 result · S12 review detail (same screen, review controls for experts). */
import { Fragment, useEffect, useState } from 'react';
import { CheckCircle2, Circle, Download, FileText, Loader2, RotateCcw, Send } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { hasRole, isChangeKind, type GradeDTO, type TestDTO } from '@silkgrade/shared';
import { PIECE_LABEL, RegionEditor } from '@/components/regions/RegionEditor';
import { PassBadge, StatusBadge } from '@/components/results/GradeBits';
import { GradeCard } from '@/components/results/GradeCard';
import { BeforeAfterSlider, ImagePanel } from '@/components/results/Viewers';
import { Badge, Button, Card, CardHeader, ErrorBox, PageHeader, Tabs } from '@/components/ui';
import { WARNING_LABEL } from '@silkgrade/shared';
import { api, download, fileSrc } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, fmtDateTime, toast } from '@/lib/utils';
import { pieceImage, specimenImage } from './useTest';

const STAGES = ['Checking images', 'Measuring colour', 'Aligning', 'Grading', 'Done'];

function GradingProgress({ test }: { test: TestDTO }) {
  const [t, setT] = useState(0);
  useEffect(() => { const h = setInterval(() => setT((x) => x + 1), 700); return () => clearInterval(h); }, []);
  const step = Math.min(3, t);
  return (
    <Card className="mx-auto max-w-md p-6">
      <h2 className="mb-4 text-base font-semibold">Grading {test.reportNo}…</h2>
      <ol className="space-y-3">
        {STAGES.map((s, i) => (
          <li key={s} className={cn('flex items-center gap-3 text-sm', i > step && 'muted')}>
            {i < step ? <CheckCircle2 className="size-5 text-green-600" /> : i === step ? <Loader2 className="size-5 animate-spin" /> : <Circle className="size-5" />}
            {s}
          </li>
        ))}
      </ol>
      <p className="muted mt-4 text-xs">Usually under 5 seconds.</p>
    </Card>
  );
}

type View = 'slider' | 'stain' | 'change' | 'regions';

export function ResultStep({ test, onChange }: { test: TestDTO; onChange: (t: TestDTO) => void }) {
  const user = useAuth((s) => s.user);
  const nav = useNavigate();
  const [view, setView] = useState<View>('slider');
  const [busy, setBusy] = useState<string | null>(null);
  const isExpert = hasRole(user?.role, 'EXPERT');

  const act = async (name: string, fn: () => Promise<TestDTO>, ok?: string) => {
    setBusy(name);
    try { onChange(await fn()); if (ok) toast.ok(ok); } catch (e) { toast.error(e); } finally { setBusy(null); }
  };

  if (test.status === 'GRADING') return <GradingProgress test={test} />;
  if (test.status === 'READY_TO_GRADE' || test.status === 'PENDING_WASH' || test.status === 'DRAFT') {
    return (
      <Card className="mx-auto max-w-lg space-y-3 p-6">
        <h2 className="font-semibold">Not graded yet</h2>
        <ErrorBox error={test.gradingError ? `Last grading attempt failed: ${test.gradingError}` : null} />
        <div className="flex gap-2">
          {test.status === 'READY_TO_GRADE' && <Button loading={busy === 'grade'} onClick={() => act('grade', () => api.grade(test.id))}><RotateCcw className="size-4" /> {test.gradingError ? 'Retry grading' : 'Grade now'}</Button>}
          <Link to={`/tests/${test.id}`}><Button variant="outline">Go to current step</Button></Link>
        </div>
      </Card>
    );
  }

  const change = test.grades.filter((g) => isChangeKind(g.kind));
  const stain = test.grades.filter((g) => !isChangeKind(g.kind));
  const locked = test.status === 'COMPLETED' || test.status === 'VOID';
  const reviewable = (g: GradeDTO) => {
    if (!isExpert || locked) return false;
    if (test.datasetMode) return !g.expertGrades.some((e) => e.userId === user?.id) && !test.labelled;
    // REVIEW grades need a decision; on a test sent to review, any grade may be accepted/overridden once
    return g.decision === 'REVIEW' ? !g.reviewed : test.status === 'NEEDS_REVIEW' && g.expertGrades.length === 0;
  };
  const review = (g: GradeDTO) => (half: number, reason?: string) => act('review', () => api.expertGrade(g.id, half, reason), test.datasetMode ? 'Blind grade saved' : 'Saved');

  const sb = specimenImage(test, 'before');
  const sa = specimenImage(test, 'after');
  const changeHeat = change.find((g) => g.heatmapUrl)?.heatmapUrl;
  const stainHeats = stain.filter((g) => g.heatmapUrl && g.kind !== 'STAIN_WORST');
  const warnings = test.engineResult?.warnings ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2"><span className="num">{test.reportNo}</span><StatusBadge status={test.status} />{!test.gradesHidden && <PassBadge pass={test.overallPass} />}</span>}
        subtitle={`Sample ${test.sampleId} · ${test.sample.fabricType.toLowerCase()} · ${test.washMethod}${test.completedAt ? ` · completed ${fmtDateTime(test.completedAt)}` : ''}`}
        actions={
          <>
            {test.status === 'GRADED_AUTO' && !test.datasetMode && (
              <Button variant="outline" loading={busy === 'send'} onClick={() => act('send', () => api.sendToReview(test.id), 'Sent to review')}><Send className="size-4" /> Send to review</Button>
            )}
            {test.canComplete && (
              <Button loading={busy === 'complete'} onClick={() => act('complete', () => api.complete(test.id), 'Completed — report generated')}>Complete & generate report</Button>
            )}
            <Button variant="outline" onClick={() => nav(`/tests/${test.id}/report`)}><FileText className="size-4" /> {test.status === 'COMPLETED' ? 'View report' : 'Preview report'}</Button>
            {test.status === 'COMPLETED' && <Button variant="outline" onClick={() => download(`/tests/${test.id}/report.pdf?download=1`, `${test.reportNo}.pdf`)}><Download className="size-4" /> PDF</Button>}
          </>
        }
      />

      {(warnings.length > 0 || test.engineResult?.registration?.ok === false) && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="muted">Engine warnings:</span>
          {warnings.map((w) => <Badge key={w} tone={w === 'noRefCard' ? 'neutral' : 'amber'}>{WARNING_LABEL[w] ?? w}</Badge>)}
        </div>
      )}
      {test.gradesHidden && (
        <div className="rounded-lg border border-violet-400 bg-violet-50 p-3 text-sm text-violet-900 dark:bg-violet-950 dark:text-violet-100">
          Dataset mode: app grades are hidden until two experts (and a third if they disagree by more than half a grade) have entered blind grades.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <section className="space-y-2" aria-label="Colour change">
            <h2 className="text-sm font-semibold">Colour change</h2>
            {change.map((g) => <GradeCard key={g.id} g={g} required={test.reqGradeChange} reviewable={reviewable(g)} onReview={review(g)} blind={test.datasetMode} compact={g.kind === 'CHANGE_MOTIF' || g.kind === 'CHANGE_GROUND'} />)}
          </section>
          <section className="space-y-2" aria-label="Staining">
            <h2 className="text-sm font-semibold">Staining</h2>
            {stain.map((g) => <GradeCard key={g.id} g={g} required={test.reqGradeStain} reviewable={reviewable(g)} onReview={review(g)} blind={test.datasetMode} />)}
          </section>
        </div>
        <div className="xl:col-span-2">
          <Card className="xl:sticky xl:top-4">
            <Tabs<View> value={view} onChange={setView} tabs={[
              { value: 'slider', label: 'Before / After' },
              { value: 'stain', label: 'Staining heat-map' },
              { value: 'change', label: 'Colour-change heat-map' },
              { value: 'regions', label: 'Regions' },
            ]} />
            <div className="p-3">
              {view === 'slider' && <BeforeAfterSlider before={fileSrc(sb?.previewUrl)} after={fileSrc(sa?.previewUrl)} />}
              {view === 'change' && <ImagePanel src={test.gradesHidden ? null : fileSrc(changeHeat)} alt="Colour-change heat-map" caption="Per-pixel ΔE00 between aligned before and after specimen" />}
              {view === 'stain' && (
                <div className="space-y-3">
                  {test.gradesHidden || !stainHeats.length ? <ImagePanel alt="Staining heat-map" /> : stainHeats.map((g) => (
                    <ImagePanel key={g.id} src={fileSrc(g.heatmapUrl)} alt={`Staining heat-map ${g.label ?? ''}`} caption={`${g.kind === 'STAIN_ADJ1' ? 'Adjacent 1' : 'Adjacent 2'} (${g.label ?? ''}) — ΔE*ab vs unwashed`} />
                  ))}
                </div>
              )}
              {view === 'regions' && <RegionsReadOnly test={test} />}
            </div>
          </Card>
        </div>
      </div>
      <Card>
        <CardHeader title="Traceability" />
        <dl className="num grid gap-x-4 gap-y-1 p-4 text-xs sm:grid-cols-2">
          <dt className="muted">Engine version</dt><dd>{test.engineResult?.engineVersion ?? test.grades[0]?.engineVersion ?? '—'}</dd>
          <dt className="muted">Model version</dt><dd>{test.engineResult?.modelVersion ?? test.grades[0]?.modelVersion ?? '—'}</dd>
          <dt className="muted">Alignment</dt><dd>{test.engineResult?.registration ? `${test.engineResult.registration.method} · ${test.engineResult.registration.inliers} inliers · ${test.engineResult.registration.ok ? 'ok' : 'failed'}` : '—'}</dd>
          <dt className="muted">Tester</dt><dd>{test.createdByName ?? '—'}</dd>
          {test.images.map((i) => (<Fragment key={i.id}><dt className="muted">{i.role.toLowerCase()} {i.side} sha256</dt><dd className="truncate" title={i.sha256}>{i.sha256}</dd></Fragment>))}
        </dl>
      </Card>
    </div>
  );
}

function RegionsReadOnly({ test }: { test: TestDTO }) {
  const [piece, setPiece] = useState<'SPECIMEN' | 'ADJ1' | 'ADJ2'>('SPECIMEN');
  const [side, setSide] = useState<'before' | 'after'>('before');
  const img = pieceImage(test, piece, side);
  const pieces = test.adjCount > 1 ? (['SPECIMEN', 'ADJ1', 'ADJ2'] as const) : (['SPECIMEN', 'ADJ1'] as const);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {pieces.map((p) => <Button key={p} size="sm" variant={p === piece ? 'primary' : 'ghost'} onClick={() => setPiece(p)}>{PIECE_LABEL[p]}</Button>)}
        <span className="mx-1" />
        {(['before', 'after'] as const).map((s) => <Button key={s} size="sm" variant={s === side ? 'primary' : 'ghost'} onClick={() => setSide(s)}>{s}</Button>)}
      </div>
      {img ? (
        <RegionEditor src={fileSrc(img.previewUrl)} width={img.width} height={img.height} readOnly pieces={[piece]}
          polygons={img.regions.map((r) => ({ key: r.id, piece: r.piece, points: r.polygon }))} onChange={() => undefined} />
      ) : <ImagePanel alt="Regions" />}
    </div>
  );
}
