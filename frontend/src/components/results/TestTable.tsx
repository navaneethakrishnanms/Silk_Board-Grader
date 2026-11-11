import { Link } from 'react-router-dom';
import type { TestSummaryDTO } from '@silkgrade/shared';
import { Empty, Table, Td, Th } from '@/components/ui';
import { fmtDate } from '@/lib/utils';
import { GradeChip, PassBadge, StatusBadge } from './GradeBits';

export function TestTable({ items, empty = 'No tests yet.', extra }: { items: TestSummaryDTO[]; empty?: string; extra?: { head: string; cell: (t: TestSummaryDTO) => React.ReactNode } }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Report</Th><Th>Sample</Th><Th className="hidden sm:table-cell">Customer</Th><Th>Status</Th>
          <Th>Change</Th><Th>Stain</Th><Th className="hidden sm:table-cell">Result</Th><Th className="hidden md:table-cell">Created</Th>
          {extra && <Th>{extra.head}</Th>}
        </tr>
      </thead>
      <tbody>
        {items.map((t) => (
          <tr key={t.id} className="hover:bg-[var(--surface-2)]">
            <Td><Link className="num font-medium underline-offset-2 hover:underline" to={`/tests/${t.id}`}>{t.reportNo}</Link></Td>
            <Td>{t.sampleId}</Td>
            <Td className="hidden sm:table-cell">{t.customer ?? '—'}</Td>
            <Td><StatusBadge status={t.status} /></Td>
            <Td><GradeChip grade={t.changeGrade} size="sm" /></Td>
            <Td><GradeChip grade={t.stainGrade} size="sm" /></Td>
            <Td className="hidden sm:table-cell">{t.status === 'COMPLETED' || t.status === 'GRADED_AUTO' || t.status === 'NEEDS_REVIEW' ? <PassBadge pass={t.overallPass} /> : '—'}</Td>
            <Td className="hidden md:table-cell muted">{fmtDate(t.createdAt)}</Td>
            {extra && <Td>{extra.cell(t)}</Td>}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
