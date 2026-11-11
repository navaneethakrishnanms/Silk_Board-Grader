/** S13 — history: search, filters, table, CSV export. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { GRADES, gradeLabel, hasRole, STATUS_LABEL, TEST_STATUSES } from '@silkgrade/shared';
import { TestTable } from '@/components/results/TestTable';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner } from '@/components/ui';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/utils';

const EMPTY = { q: '', status: '', batchId: '', customer: '', from: '', to: '', pass: '', gradeMin: '', gradeMax: '' };

export function HistoryPage() {
  const user = useAuth((s) => s.user);
  const [f, setF] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const set = (k: keyof typeof EMPTY, v: string) => { setF((s) => ({ ...s, [k]: v })); setPage(1); };
  const query = { ...f, page, pageSize: 25 };
  const q = useQuery({ queryKey: ['tests', 'history', query], queryFn: () => api.tests(query), placeholderData: keepPreviousData });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const grades = [...GRADES].reverse();
  return (
    <>
      <PageHeader
        title="History"
        actions={hasRole(user?.role, 'EXPERT') && (
          <Button variant="outline" onClick={() => download(api.csvPath(f), 'tests.csv').catch(toast.error)}><Download className="size-4" /> Export CSV</Button>
        )}
      />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Search" htmlFor="hq"><Input id="hq" placeholder="Report no., sample, customer" value={f.q} onChange={(e) => set('q', e.target.value)} /></Field>
          <Field label="Status" htmlFor="hs">
            <Select id="hs" value={f.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">Any</option>
              {TEST_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Batch" htmlFor="hb"><Input id="hb" value={f.batchId} onChange={(e) => set('batchId', e.target.value)} /></Field>
          <Field label="Customer" htmlFor="hc"><Input id="hc" value={f.customer} onChange={(e) => set('customer', e.target.value)} /></Field>
          <Field label="Result" htmlFor="hp">
            <Select id="hp" value={f.pass} onChange={(e) => set('pass', e.target.value)}><option value="">Any</option><option value="pass">Pass</option><option value="fail">Fail</option></Select>
          </Field>
          <Field label="From" htmlFor="hf"><Input id="hf" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></Field>
          <Field label="To" htmlFor="ht"><Input id="ht" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></Field>
          <Field label="Change grade ≥" htmlFor="gmin">
            <Select id="gmin" value={f.gradeMin} onChange={(e) => set('gradeMin', e.target.value)}><option value="">Any</option>{grades.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}</Select>
          </Field>
          <Field label="Change grade ≤" htmlFor="gmax">
            <Select id="gmax" value={f.gradeMax} onChange={(e) => set('gradeMax', e.target.value)}><option value="">Any</option>{grades.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}</Select>
          </Field>
          <div className="flex items-end"><Button variant="ghost" onClick={() => { setF(EMPTY); setPage(1); }}>Clear filters</Button></div>
        </div>
      </Card>
      <ErrorBox error={q.error} />
      <Card>
        {!q.data ? <div className="p-4"><Spinner /></div> : <TestTable items={q.data.items} empty="No tests match these filters." />}
        {q.data && (
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="muted">{q.data.total} tests</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="num">{page} / {pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
