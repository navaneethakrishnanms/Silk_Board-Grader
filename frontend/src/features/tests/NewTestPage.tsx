/** S3 — New Test, Step 1: details. Also used to edit details while DRAFT/PENDING_WASH. */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { QrCode } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { GRADES, gradeLabel, hasRole, type CreateTestInput, type TestDTO } from '@silkgrade/shared';
import { Button, Card, CardHeader, ErrorBox, Field, Input, PageHeader, Segmented, Select, Switch, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/utils';
import { Stepper } from './Stepper';

type Form = {
  sampleId: string; batchId: string; customer: string; fabricType: 'PLAIN' | 'PRINTED'; construction: string;
  baseShade: '' | 'light' | 'medium' | 'dark'; dominantHue: string; dyeClass: string; notes: string;
  washMethod: string; washTempC: string; washTimeMin: string; adjCount: 1 | 2; adj1Fibre: string; adj2Fibre: string;
  reqGradeChange: string; reqGradeStain: string; datasetMode: boolean; uploadMode: 'separate' | 'single'; captureDevice: string;
};

const EMPTY: Form = {
  sampleId: '', batchId: '', customer: '', fabricType: 'PLAIN', construction: '', baseShade: '', dominantHue: '', dyeClass: '', notes: '',
  washMethod: '', washTempC: '40', washTimeMin: '30', adjCount: 2, adj1Fibre: 'silk', adj2Fibre: 'cotton',
  reqGradeChange: '4', reqGradeStain: '3.5', datasetMode: false, uploadMode: 'separate', captureDevice: '',
};

function fromTest(t: TestDTO): Form {
  return {
    sampleId: t.sample.id, batchId: t.sample.batchId ?? '', customer: t.sample.customer ?? '', fabricType: t.sample.fabricType,
    construction: t.sample.construction ?? '', baseShade: (t.sample.baseShade as Form['baseShade']) ?? '', dominantHue: t.sample.dominantHue ?? '',
    dyeClass: t.sample.dyeClass ?? '', notes: t.sample.notes ?? '', washMethod: t.washMethod, washTempC: t.washTempC?.toString() ?? '',
    washTimeMin: t.washTimeMin?.toString() ?? '', adjCount: t.adjCount as 1 | 2, adj1Fibre: t.adj1Fibre, adj2Fibre: t.adj2Fibre ?? 'cotton',
    reqGradeChange: t.reqGradeChange?.toString() ?? '', reqGradeStain: t.reqGradeStain?.toString() ?? '', datasetMode: t.datasetMode,
    uploadMode: t.uploadMode, captureDevice: t.captureDevice ?? '',
  };
}

const num = (s: string) => (s.trim() === '' ? null : Number(s));

export function TestDetailsForm({ existing, onSaved }: { existing?: TestDTO; onSaved: (t: TestDTO) => void }) {
  const user = useAuth((s) => s.user);
  const settings = useQuery({ queryKey: ['settings', 'public'], queryFn: api.publicSettings });
  const [f, setF] = useState<Form>(existing ? fromTest(existing) : EMPTY);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!existing && settings.data && !f.washMethod) set('washMethod', settings.data.washMethods[0] ?? '');
  }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async () => {
      const body: CreateTestInput = {
        sample: {
          id: f.sampleId.trim(), batchId: f.batchId || null, customer: f.customer || null, fibre: 'silk', fabricType: f.fabricType,
          construction: f.construction || null, baseShade: f.baseShade || null, dominantHue: f.dominantHue || null, dyeClass: f.dyeClass || null, notes: f.notes || null,
        },
        washMethod: f.washMethod, washTempC: num(f.washTempC), washTimeMin: num(f.washTimeMin), adjCount: f.adjCount,
        adj1Fibre: f.adj1Fibre, adj2Fibre: f.adjCount === 2 ? f.adj2Fibre : null, reqGradeChange: num(f.reqGradeChange),
        reqGradeStain: num(f.reqGradeStain), datasetMode: f.datasetMode, uploadMode: f.uploadMode, captureDevice: f.captureDevice || null,
      };
      if (!existing) return api.createTest(body);
      const { sample, ...rest } = body;
      const { id: _id, ...sampleRest } = sample;
      return api.updateTest(existing.id, { ...rest, sample: sampleRest });
    },
    onSuccess: (t) => { toast.ok(existing ? 'Details saved' : `Test ${t.reportNo} created`); onSaved(t); },
  });

  async function scanQr(file: File) {
    const BD = (window as unknown as { BarcodeDetector?: new (o: unknown) => { detect: (b: ImageBitmap) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) return toast.info('QR scanning is not supported in this browser — type the sample ID.');
    try {
      const codes = await new BD({ formats: ['qr_code', 'code_128', 'ean_13'] }).detect(await createImageBitmap(file));
      if (codes[0]) set('sampleId', codes[0].rawValue.trim());
      else toast.info('No code found in the photo');
    } catch (e) { toast.error(e); }
  }

  const applyPreset = (name: string) => {
    const p = settings.data?.requiredPresets.find((x) => x.name === name);
    if (p) setF((s) => ({ ...s, reqGradeChange: p.change?.toString() ?? '', reqGradeStain: p.stain?.toString() ?? '' }));
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const gradeOptions = [<option key="" value="">None</option>, ...[...GRADES].reverse().map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)];
  const locked = existing && existing.images.length > 0;

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card>
        <CardHeader title="Sample" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Sample ID *" htmlFor="sampleId">
            <div className="flex gap-2">
              <Input id="sampleId" required disabled={!!existing} value={f.sampleId} onChange={(e) => set('sampleId', e.target.value)} placeholder="BSB-2026-00123" />
              {!existing && (
                <>
                  <Button type="button" variant="outline" onClick={() => scanRef.current?.click()} aria-label="Scan QR code"><QrCode className="size-4" /></Button>
                  <input ref={scanRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && scanQr(e.target.files[0])} />
                </>
              )}
            </div>
          </Field>
          <Field label="Batch" htmlFor="batch"><Input id="batch" value={f.batchId} onChange={(e) => set('batchId', e.target.value)} /></Field>
          <Field label="Customer" htmlFor="customer"><Input id="customer" value={f.customer} onChange={(e) => set('customer', e.target.value)} /></Field>
          <Field label="Fabric type">
            <Segmented ariaLabel="Fabric type" value={f.fabricType} onChange={(v) => set('fabricType', v)} options={[{ value: 'PLAIN', label: 'Plain' }, { value: 'PRINTED', label: 'Printed' }]} />
          </Field>
          <Field label="Construction" htmlFor="construction">
            <Input id="construction" list="constructions" value={f.construction} onChange={(e) => set('construction', e.target.value)} />
            <datalist id="constructions">{['satin', 'crepe', 'georgette', 'plain weave', 'chiffon', 'organza'].map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Shade" htmlFor="shade">
            <Select id="shade" value={f.baseShade} onChange={(e) => set('baseShade', e.target.value as Form['baseShade'])}>
              <option value="">—</option><option value="light">Light</option><option value="medium">Medium</option><option value="dark">Dark</option>
            </Select>
          </Field>
          <Field label="Dominant hue" htmlFor="hue"><Input id="hue" value={f.dominantHue} onChange={(e) => set('dominantHue', e.target.value)} /></Field>
          <Field label="Dye class" htmlFor="dye"><Input id="dye" value={f.dyeClass} onChange={(e) => set('dyeClass', e.target.value)} /></Field>
          <Field label="Notes" htmlFor="notes" className="sm:col-span-2 lg:col-span-1"><Textarea id="notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Wash and grading" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Wash method *" htmlFor="wash">
            <Select id="wash" required value={f.washMethod} onChange={(e) => set('washMethod', e.target.value)}>
              {(settings.data?.washMethods ?? []).map((w) => <option key={w} value={w}>{w}</option>)}
              {f.washMethod && !settings.data?.washMethods.includes(f.washMethod) && <option value={f.washMethod}>{f.washMethod}</option>}
            </Select>
          </Field>
          <Field label="Temperature (°C)" htmlFor="temp"><Input id="temp" type="number" step="any" value={f.washTempC} onChange={(e) => set('washTempC', e.target.value)} /></Field>
          <Field label="Time (min)" htmlFor="time"><Input id="time" type="number" step="any" value={f.washTimeMin} onChange={(e) => set('washTimeMin', e.target.value)} /></Field>
          <Field label="Adjacent fabrics">
            <Segmented ariaLabel="Number of adjacent fabrics" value={f.adjCount} onChange={(v) => set('adjCount', v)} options={[{ value: 1, label: '1' }, { value: 2, label: '2' }]} />
          </Field>
          <Field label="Adjacent 1 fibre" htmlFor="adj1"><Input id="adj1" value={f.adj1Fibre} onChange={(e) => set('adj1Fibre', e.target.value)} /></Field>
          {f.adjCount === 2 && <Field label="Adjacent 2 fibre" htmlFor="adj2"><Input id="adj2" value={f.adj2Fibre} onChange={(e) => set('adj2Fibre', e.target.value)} /></Field>}
          <Field label="Required grade preset" htmlFor="preset">
            <Select id="preset" defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
              <option value="">Choose a preset…</option>
              {(settings.data?.requiredPresets ?? []).map((p) => <option key={p.name} value={p.name}>{p.name}{p.customer ? ` (${p.customer})` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Required — colour change" htmlFor="reqc"><Select id="reqc" value={f.reqGradeChange} onChange={(e) => set('reqGradeChange', e.target.value)}>{gradeOptions}</Select></Field>
          <Field label="Required — staining" htmlFor="reqs"><Select id="reqs" value={f.reqGradeStain} onChange={(e) => set('reqGradeStain', e.target.value)}>{gradeOptions}</Select></Field>
          <Field label="Image upload mode" hint={locked ? 'Delete images to change the mode' : 'One photo per piece, or one photo with all pieces'}>
            <Segmented ariaLabel="Upload mode" value={f.uploadMode} onChange={(v) => !locked && set('uploadMode', v)} options={[{ value: 'separate', label: 'Separate pieces' }, { value: 'single', label: 'Single image' }]} />
          </Field>
          <Field label="Capture device" htmlFor="device" hint="Use the same device before and after washing"><Input id="device" value={f.captureDevice} onChange={(e) => set('captureDevice', e.target.value)} placeholder="e.g. Pixel 8 / Epson V600" /></Field>
          {hasRole(user?.role, 'EXPERT') && (
            <Field label="Dataset mode" hint="Blind expert labelling — app grades stay hidden until labelled">
              <Switch checked={f.datasetMode} onChange={(v) => set('datasetMode', v)} label={f.datasetMode ? 'On' : 'Off'} disabled={!!existing && existing.status !== 'DRAFT'} />
            </Field>
          )}
        </div>
      </Card>
      <ErrorBox error={save.error} />
      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={save.isPending}>{existing ? 'Save details' : 'Create test & upload images'}</Button>
      </div>
    </form>
  );
}

export function NewTestPage() {
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="New test" subtitle="Step 1 of 5 — details" />
      <Stepper current={0} />
      <TestDetailsForm onSaved={(t) => nav(`/tests/${t.id}/before`)} />
    </>
  );
}
