/** WP7 — pilot-readiness tools: repeatability, device comparison, data coverage, shadow-mode report. */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GRADE_CODE, GRADE_KIND_LABEL, gradeLabel } from '@silkgrade/shared';
import { Badge, Card, CardHeader, Empty, ErrorBox, PageHeader, Select, Spinner, Table, Tabs, Td, Th } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Tab = 'repeat' | 'devices' | 'coverage' | 'shadow';

export function PilotPage() {
  const [tab, setTab] = useState<Tab>('repeat');
  return (
    <>
      <PageHeader title="Pilot tools" subtitle="Check repeatability, device effects, data coverage and live agreement before go-live" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'repeat', label: 'Repeatability' },
        { value: 'devices', label: 'Device comparison' },
        { value: 'coverage', label: 'Data coverage' },
        { value: 'shadow', label: 'Shadow mode' },
      ]} />
      <div className="mt-4">
        {tab === 'repeat' && <SamplePicker hint="Create several tests with the same sample ID (same composite, re-photographed) and grade each." render={(id) => <Repeatability sampleId={id} />} />}
        {tab === 'devices' && <SamplePicker hint="Grade the same composite photographed on two devices (set the capture device on each test)." render={(id) => <Devices sampleId={id} />} />}
        {tab === 'coverage' && <Coverage />}
        {tab === 'shadow' && <Shadow />}
      </div>
    </>
  );
}

function SamplePicker({ render, hint }: { render: (id: string) => React.ReactNode; hint: string }) {
  const q = useQuery({ queryKey: ['pilot', 'samples'], queryFn: api.pilotSamples });
  const [id, setId] = useState('');
  if (!q.data) return q.error ? <ErrorBox error={q.error} /> : <Spinner />;
  if (!q.data.length) return <Empty>No sample has been graded more than once yet. {hint}</Empty>;
  const sel = id || q.data[0].sampleId;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="pilot-sample" className="text-sm">Sample</label>
        <Select id="pilot-sample" className="w-72" value={sel} onChange={(e) => setId(e.target.value)}>
          {q.data.map((s) => <option key={s.sampleId} value={s.sampleId}>{s.sampleId} — {s.tests} tests, {s.devices.length} device(s)</option>)}
        </Select>
        <span className="muted text-xs">{hint}</span>
      </div>
      {render(sel)}
    </div>
  );
}

function Repeatability({ sampleId }: { sampleId: string }) {
  const q = useQuery({ queryKey: ['pilot', 'repeat', sampleId], queryFn: () => api.repeatability(sampleId) });
  if (!q.data) return <Spinner />;
  return (
    <Card>
      <CardHeader title={`Repeatability — ${sampleId}`} subtitle={`${q.data.tests.length} graded tests of the same composite. A grade is stable when every repeat is within half a grade.`} />
      <Table>
        <thead><tr><Th>Grade</Th><Th>n</Th><Th>Min</Th><Th>Max</Th><Th>Range</Th><Th>Mean</Th><Th>SD</Th><Th>Half grades</Th><Th>Stable</Th></tr></thead>
        <tbody>
          {q.data.rows.map((r) => (
            <tr key={r.kind}>
              <Td>{GRADE_CODE[r.kind]} {GRADE_KIND_LABEL[r.kind]}</Td>
              <Td className="num">{r.n}</Td><Td className="num">{r.min.toFixed(2)}</Td><Td className="num">{r.max.toFixed(2)}</Td>
              <Td className="num">{r.range.toFixed(2)}</Td><Td className="num">{r.mean.toFixed(2)}</Td><Td className="num">{r.sd.toFixed(3)}</Td>
              <Td className="num">{r.halfGrades.map(gradeLabel).join(', ')}</Td>
              <Td>{r.stable ? <Badge tone="green">Stable</Badge> : <Badge tone="amber">Unstable</Badge>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function Devices({ sampleId }: { sampleId: string }) {
  const q = useQuery({ queryKey: ['pilot', 'devices', sampleId], queryFn: () => api.devices(sampleId) });
  if (!q.data) return <Spinner />;
  const d = q.data;
  return (
    <Card>
      <CardHeader title={`Device comparison — ${sampleId}`} subtitle={`Mean rating per device; warns when devices differ by more than ${d.warnThreshold} grade.`} />
      {d.devices.length < 2 && <p className="muted px-4 pt-3 text-sm">Only one device found for this sample — grade it on a second device to compare.</p>}
      <Table>
        <thead><tr><Th>Grade</Th>{d.devices.map((x) => <Th key={x}>{x}</Th>)}<Th>Max difference</Th></tr></thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.kind} className={cn(r.warn && 'bg-amber-50 dark:bg-amber-950')}>
              <Td>{GRADE_CODE[r.kind]} {GRADE_KIND_LABEL[r.kind]}</Td>
              {d.devices.map((x) => <Td key={x} className="num">{r.perDevice[x]?.toFixed(2) ?? '—'}</Td>)}
              <Td className="num">{r.maxDiff === null ? '—' : <span className="inline-flex items-center gap-1">{r.maxDiff.toFixed(2)} {r.warn && <AlertTriangle className="size-4 text-amber-600" aria-label="Difference above limit" />}</span>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function Coverage() {
  const q = useQuery({ queryKey: ['pilot', 'coverage'], queryFn: api.coverage });
  if (!q.data) return q.error ? <ErrorBox error={q.error} /> : <Spinner />;
  const c = q.data;
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-1 flex justify-between text-sm"><span>Labelled composites</span><span className="num">{c.labelledTests} / {c.target.min}–{c.target.max}</span></div>
        <div className="h-3 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-valuenow={Math.round(c.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-[var(--accent)]" style={{ width: `${c.progress * 100}%` }} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Records per grade" subtitle={`Highlighted cells have fewer than ${c.minPerGrade} labelled records`} />
        <Table>
          <thead><tr><Th>Grade type</Th>{c.table[0]?.counts.map((x) => <Th key={x.grade} className="text-center">{gradeLabel(x.grade)}</Th>)}</tr></thead>
          <tbody>
            {c.table.map((row) => (
              <tr key={row.kind}>
                <Td>{GRADE_CODE[row.kind]} {GRADE_KIND_LABEL[row.kind]}</Td>
                {row.counts.map((x) => <Td key={x.grade} className={cn('num text-center', x.low && 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200')}>{x.n}</Td>)}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function Shadow() {
  const q = useQuery({ queryKey: ['pilot', 'shadow'], queryFn: api.shadow });
  if (!q.data) return q.error ? <ErrorBox error={q.error} /> : <Spinner />;
  const s = q.data;
  if (!s.weekly.length) return <Empty>No expert-graded tests yet. The app grade is compared with the expert grade on every reviewed test.</Empty>;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="App vs expert, weekly" subtitle="Exact and ±0.5 agreement of the app half grade with the expert grade" />
        <div className="h-72 p-3">
          <ResponsiveContainer>
            <LineChart data={s.weekly.map((w) => ({ ...w, exactPct: w.exact * 100, withinPct: w.withinHalf * 100 }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <YAxis domain={[0, 100]} unit="%" width={44} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="withinPct" name="Within ±0.5" stroke="#16a34a" strokeWidth={2} dot />
              <Line dataKey="exactPct" name="Exact" stroke="#52525b" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <CardHeader title="By grade type" />
        <Table>
          <thead><tr><Th>Grade type</Th><Th>n</Th><Th>Exact</Th><Th>Within ±0.5</Th></tr></thead>
          <tbody>{s.byKind.map((k) => <tr key={k.kind}><Td>{GRADE_KIND_LABEL[k.kind]}</Td><Td className="num">{k.n}</Td><Td className="num">{Math.round(k.exact * 100)}%</Td><Td className="num">{Math.round(k.withinHalf * 100)}%</Td></tr>)}</tbody>
        </Table>
      </Card>
    </div>
  );
}
