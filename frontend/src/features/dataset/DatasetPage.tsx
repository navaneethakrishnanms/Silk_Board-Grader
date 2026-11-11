/** S14 — dataset: counts per grade per grade type, blind-labelling progress, export, agreement. */
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GRADE_KIND_LABEL, GRADE_KINDS, gradeLabel, hasRole, type GradeKind } from '@silkgrade/shared';
import { Button, Card, CardHeader, Empty, ErrorBox, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/utils';

export function DatasetPage() {
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: ['dataset'], queryFn: api.datasetStats });
  const [kind, setKind] = useState<GradeKind>('CHANGE_OVERALL');
  const [busy, setBusy] = useState(false);
  const data = useMemo(() => (q.data?.counts ?? []).filter((c) => c.kind === kind).map((c) => ({ ...c, label: gradeLabel(c.grade) })), [q.data, kind]);
  const d = q.data;
  return (
    <>
      <PageHeader
        title="Dataset"
        subtitle="Expert-labelled data for training the correction models"
        actions={hasRole(user?.role, 'ADMIN') && (
          <Button loading={busy} onClick={async () => { setBusy(true); try { await download('/export/dataset.zip', 'dataset.zip'); } catch (e) { toast.error(e); } finally { setBusy(false); } }}>
            <Download className="size-4" /> Export dataset (zip)
          </Button>
        )}
      />
      <ErrorBox error={q.error} />
      {!d ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[['Dataset-mode tests', d.blind.total], ['Fully labelled', d.blind.labelled], ['Awaiting 2nd expert', d.blind.awaitingSecond], ['Awaiting 3rd expert', d.blind.awaitingThird]].map(([l, v]) => (
              <Card key={l as string} className="p-4"><div className="muted text-xs">{l}</div><div className="num mt-1 text-2xl font-semibold">{v}</div></Card>
            ))}
          </div>
          <Card>
            <CardHeader
              title="Labelled samples per grade"
              subtitle={`Grades with fewer than ${d.minPerGrade} samples are highlighted`}
              actions={<Select aria-label="Grade type" className="w-64" value={kind} onChange={(e) => setKind(e.target.value as GradeKind)}>{GRADE_KINDS.map((k) => <option key={k} value={k}>{GRADE_KIND_LABEL[k]}</option>)}</Select>}
            />
            <div className="h-72 p-3">
              <ResponsiveContainer>
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis allowDecimals={false} width={32} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12 }} />
                  <ReferenceLine y={d.minPerGrade} stroke="#d97706" strokeDasharray="4 4" label={{ value: `target ${d.minPerGrade}`, fontSize: 11, fill: '#d97706', position: 'insideTopRight' }} />
                  <Bar dataKey="n" name="Samples" radius={[3, 3, 0, 0]}>
                    {data.map((e) => <Cell key={e.grade} fill={e.n < d.minPerGrade ? '#d97706' : '#52525b'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <CardHeader title="Inter-assessor agreement" subtitle={`Assessor A vs B on the same grades (the human benchmark) · consensus rule: ${d.consensusRule.replace(/_/g, ' ')}`} />
            {d.agreement.reduce((s, a) => s + a.n, 0) < d.agreementMinRecords ? (
              <div className="p-4"><Empty>Shown once {d.agreementMinRecords} records have two blind grades ({d.agreement.reduce((s, a) => s + a.n, 0)} so far).</Empty></div>
            ) : (
              <Table>
                <thead><tr><Th>Grade type</Th><Th>Pairs</Th><Th>Exact</Th><Th>Within ±0.5</Th><Th>Weighted kappa</Th></tr></thead>
                <tbody>
                  {d.agreement.map((a) => (
                    <tr key={a.kind}><Td>{GRADE_KIND_LABEL[a.kind]}</Td><Td className="num">{a.n}</Td><Td className="num">{Math.round(a.exact * 100)}%</Td><Td className="num">{Math.round(a.withinHalf * 100)}%</Td><Td className="num">{a.qwk === null ? '—' : a.qwk.toFixed(2)}</Td></tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
