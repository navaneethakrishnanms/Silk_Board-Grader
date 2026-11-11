import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { gradeLabel, hasRole } from '@silkgrade/shared';
import { TestTable } from '@/components/results/TestTable';
import { Button, Card, CardHeader, ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function Kpi({ label, value, to }: { label: string; value: string | number; to?: string }) {
  const body = (
    <Card className="p-4 transition hover:brightness-[0.98]">
      <div className="muted text-xs font-medium">{label}</div>
      <div className="num mt-1 text-2xl font-semibold">{value}</div>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard, refetchInterval: 30_000 });
  const d = q.data;
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome, ${user?.name ?? ''}`}
        actions={hasRole(user?.role, 'TESTER') && <Link to="/tests/new"><Button size="lg"><Plus className="size-4" /> New Test</Button></Link>}
      />
      <ErrorBox error={q.error} />
      {!d ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Pending wash" value={d.pendingWash} to="/pending" />
            <Kpi label="Needs review" value={d.needsReview} to={hasRole(user?.role, 'EXPERT') ? '/review' : undefined} />
            <Kpi label="Completed today" value={d.completedToday} />
            <Kpi label="Pass rate (30 days)" value={d.passRate30d === null ? '—' : `${Math.round(d.passRate30d * 100)}%`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Recent tests" actions={<Link className="muted text-xs hover:underline" to="/history">View all</Link>} />
              <TestTable items={d.recent} />
            </Card>
            <Card>
              <CardHeader title="Grade distribution" subtitle="Completed tests, last 30 days" />
              <div className="h-64 p-3">
                <ResponsiveContainer>
                  <BarChart data={d.gradeDistribution.map((g) => ({ ...g, label: gradeLabel(g.grade) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={28} />
                    <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="change" name="Colour change" fill="#52525b" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="stain" name="Staining" fill="#a1a1aa" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
