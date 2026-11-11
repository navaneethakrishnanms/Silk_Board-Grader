/** S5 / S8 — confirm regions; after-wash adds the alignment check (overlay slider, 2-point fallback). */
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { AlignmentCheckDTO, ImageDTO, Side, TestDTO } from '@silkgrade/shared';
import { newKey, RegionEditor, type EditablePolygon } from '@/components/regions/RegionEditor';
import { BeforeAfterSlider } from '@/components/results/Viewers';
import { Button, Card, CardHeader, ErrorBox, Spinner } from '@/components/ui';
import { api, fileSrc } from '@/lib/api';
import { toast } from '@/lib/utils';
import { sideImages, slotsFor, specimenImage } from './useTest';

const toPolys = (img: ImageDTO): EditablePolygon[] =>
  img.regions.map((r) => ({ key: r.id || newKey(), piece: r.piece, points: r.polygon, confidence: r.confidence, edited: !r.autoDetected }));

export function RegionsStep({ test, side, onChange }: { test: TestDTO; side: Side; onChange: (t: TestDTO) => void }) {
  const nav = useNavigate();
  const images = sideImages(test, side);
  const editable = side === 'before' ? test.status === 'DRAFT' : ['PENDING_WASH', 'READY_TO_GRADE'].includes(test.status);
  const [polys, setPolys] = useState<Record<string, EditablePolygon[]>>(() => Object.fromEntries(images.map((i) => [i.id, toPolys(i)])));
  const [active, setActive] = useState(images[0]?.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [align, setAlign] = useState<AlignmentCheckDTO | null>(null);
  const detected = useRef(false);

  const reset = (t: TestDTO) => setPolys(Object.fromEntries(sideImages(t, side).map((i) => [i.id, toPolys(i)])));

  async function detect() {
    setBusy(true); setError(null);
    try { const t = await api.detectRegions(test.id, side); onChange(t); reset(t); } catch (e) { setError(e); } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!detected.current && editable && images.length && images.every((i) => i.regions.length === 0)) {
      detected.current = true;
      void detect();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(): Promise<TestDTO | null> {
    const regions = Object.entries(polys).flatMap(([imageId, ps]) => ps.map((p) => ({ imageId, piece: p.piece, polygon: p.points, edited: !!p.edited })));
    if (!regions.length) { setError(new Error('Draw at least one region')); return null; }
    const t = await api.saveRegions(test.id, regions);
    onChange(t);
    return t;
  }

  async function confirm() {
    setBusy(true); setError(null);
    try {
      if (!(await save())) return;
      if (side === 'before') {
        onChange(await api.markBeforeDone(test.id));
        toast.ok('Saved. Come back after washing.');
        nav('/pending');
      } else {
        const a = await api.checkAlignment(test.id);
        setAlign(a);
        if (!a.ok && !test.manualPoints) toast.info('Automatic alignment failed — tap the same 2 points on both images.');
      }
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  async function gradeNow() {
    setBusy(true); setError(null);
    try {
      let t = test;
      if (t.status === 'PENDING_WASH') t = await api.markAfterDone(test.id);
      t = await api.grade(test.id);
      onChange(t);
      nav(`/tests/${test.id}/result`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  const img = images.find((i) => i.id === active);
  const slot = img && slotsFor(test, side).find((s) => s.role === img.role);
  const canGrade = side === 'after' && align && (align.ok || !!test.manualPoints);

  if (!images.length) return <ErrorBox error={`Upload the ${side}-wash images first.`} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Regions"
          subtitle="Check each piece is outlined; drag corners to fix, draw missing pieces, delete extras."
          actions={editable && <Button variant="outline" size="sm" loading={busy} onClick={detect}><RefreshCw className="size-4" /> Auto-detect again</Button>}
        />
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-3 pt-2">
          {images.map((i) => (
            <button key={i.id} onClick={() => setActive(i.id)} className={`whitespace-nowrap rounded-t-md px-3 py-1.5 text-sm ${active === i.id ? 'bg-[var(--surface-2)] font-medium' : 'muted'}`}>
              {slotsFor(test, side).find((s) => s.role === i.role)?.title ?? i.role}
              <span className="num muted ml-1 text-xs">({polys[i.id]?.length ?? 0})</span>
            </button>
          ))}
        </div>
        <div className="p-3">
          {busy && !img?.regions.length ? <Spinner /> : img && (
            <RegionEditor
              key={img.id}
              src={fileSrc(img.previewUrl)}
              width={img.width}
              height={img.height}
              polygons={polys[img.id] ?? []}
              onChange={(p) => setPolys((s) => ({ ...s, [img.id]: p }))}
              pieces={slot?.pieces ?? ['SPECIMEN']}
              readOnly={!editable}
            />
          )}
        </div>
      </Card>
      <ErrorBox error={error} />

      {side === 'after' && align && <AlignmentPanel test={test} align={align} onChange={onChange} />}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => nav(`/tests/${test.id}/${side}`)}>Back to images</Button>
        {editable && <Button size="lg" loading={busy} onClick={confirm}>{side === 'before' ? 'Looks right — save' : align ? 'Save regions & re-check alignment' : 'Looks right — check alignment'}</Button>}
        {canGrade && <Button size="lg" loading={busy} onClick={gradeNow}>Grade now</Button>}
      </div>
    </div>
  );
}

function AlignmentPanel({ test, align, onChange }: { test: TestDTO; align: AlignmentCheckDTO; onChange: (t: TestDTO) => void }) {
  const b = specimenImage(test, 'before');
  const a = specimenImage(test, 'after');
  const [pts, setPts] = useState<{ before: [number, number][]; after: [number, number][] }>(test.manualPoints ?? { before: [], after: [] });
  const [busy, setBusy] = useState(false);
  const tap = (side: 'before' | 'after', img: ImageDTO) => (e: MouseEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * img.width;
    const y = ((e.clientY - r.top) / r.height) * img.height;
    setPts((p) => ({ ...p, [side]: [...p[side], [Math.round(x), Math.round(y)]].slice(-2) as [number, number][] }));
  };
  async function saveManual() {
    setBusy(true);
    try { onChange(await api.setAlignment(test.id, pts)); toast.ok('Manual alignment saved'); } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2">Specimen alignment {align.ok ? <CheckCircle2 className="size-4 text-green-600" /> : <XCircle className="size-4 text-red-600" />}</span>}
        subtitle={align.ok ? `Aligned automatically (${align.method}, ${align.inliers} matching points). Slide to compare.` : `Automatic alignment failed (${align.message ?? align.method}). Tap the same 2 points on both images.`}
      />
      <div className="p-4">
        {align.ok ? (
          <div className="max-w-2xl"><BeforeAfterSlider before={fileSrc(b?.previewUrl)} after={fileSrc(a?.previewUrl)} /></div>
        ) : b && a && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {([['before', b], ['after', a]] as const).map(([s, img]) => (
                <div key={s}>
                  <div className="muted mb-1 text-xs">{s === 'before' ? 'Before wash' : 'After wash'} — {pts[s].length}/2 points</div>
                  <div className="booth relative overflow-hidden rounded-lg">
                    <img src={fileSrc(img.previewUrl)} alt={`Specimen ${s}`} onClick={tap(s, img)} className="w-full cursor-crosshair" />
                    {pts[s].map(([x, y], i) => (
                      <span key={i} className="absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white ring-2 ring-white"
                        style={{ left: `${(x / img.width) * 100}%`, top: `${(y / img.height) * 100}%` }}>{i + 1}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button disabled={pts.before.length < 2 || pts.after.length < 2} loading={busy} onClick={saveManual}>Use these points</Button>
              <Button variant="ghost" onClick={() => setPts({ before: [], after: [] })}>Clear</Button>
              {test.manualPoints && <span className="self-center text-sm text-green-700">Manual alignment saved</span>}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
