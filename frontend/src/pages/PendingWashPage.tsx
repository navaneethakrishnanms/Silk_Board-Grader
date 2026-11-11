import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { TestTable } from '@/components/results/TestTable';
import { api } from '@/lib/api';

export function PendingWashPage() {
  const q = useQuery({ queryKey: ['tests', 'pending'], queryFn: () => api.tests({ status: 'PENDING_WASH,READY_TO_GRADE', pageSize: 100 }) });
  return (
    <>
      <PageHeader title="Pending wash" subtitle="Tests waiting for after-wash images" />
      <ErrorBox error={q.error} />
      <Card>
        {!q.data ? <div className="p-4"><Spinner /></div> : (
          <TestTable
            items={q.data.items}
            empty="Nothing is waiting for washing."
            extra={{
              head: 'Age',
              cell: (t) => (
                <div className="flex items-center gap-2">
                  <span className="num muted text-xs">{t.ageDays} d</span>
                  <Link to={`/tests/${t.id}/after`}><Button size="sm" variant="outline">{t.status === 'READY_TO_GRADE' ? 'Grade' : 'Add after-wash images'}</Button></Link>
                </div>
              ),
            }}
          />
        )}
      </Card>
    </>
  );
}
