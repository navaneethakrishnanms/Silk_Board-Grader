/** S11 — review queue. Opening a row shows S12 (result screen with review controls). */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GRADE_CODE, REVIEW_REASON_LABEL } from '@silkgrade/shared';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { api } from '@/lib/api';

export function ReviewQueuePage() {
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['review', reason], queryFn: () => api.review({ reason }), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader
        title="Review queue"
        subtitle="Tests with grades that need an expert decision"
        actions={
          <Select aria-label="Filter by reason" className="w-60" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">All reasons</option>
            {Object.entries(REVIEW_REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        }
      />
      <ErrorBox error={q.error} />
      <Card>
        {!q.data ? <div className="p-4"><Spinner /></div> : !q.data.length ? <div className="p-4"><Empty>The review queue is empty.</Empty></div> : (
          <Table>
            <thead><tr><Th>Report</Th><Th>Sample</Th><Th>Grades to review</Th><Th>Reason</Th><Th>Age</Th><Th /></tr></thead>
            <tbody>
              {q.data.map((t) => (
                <tr key={t.id} className="hover:bg-[var(--surface-2)]">
                  <Td className="num font-medium">{t.reportNo}{t.datasetMode && <Badge tone="violet" className="ml-2">blind</Badge>}</Td>
                  <Td>{t.sampleId}</Td>
                  <Td><span className="flex flex-wrap gap-1">{t.reviewKinds?.length ? t.reviewKinds.map((k) => <Badge key={k}>{GRADE_CODE[k]}</Badge>) : <span className="muted text-xs">sent for review</span>}</span></Td>
                  <Td className="text-xs">{(t.reviewReasons ?? []).map((r) => REVIEW_REASON_LABEL[r] ?? r).join(' · ') || '—'}</Td>
                  <Td className="num">{t.ageDays} d</Td>
                  <Td><Link to={`/tests/${t.id}/result`}><Button size="sm">Review</Button></Link></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
