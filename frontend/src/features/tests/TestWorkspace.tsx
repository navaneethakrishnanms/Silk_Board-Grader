import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { StatusBadge } from '@/components/results/GradeBits';
import { TestDetailsForm } from './NewTestPage';
import { RegionsStep } from './RegionsStep';
import { ResultStep } from './ResultStep';
import { Stepper } from './Stepper';
import { UploadStep } from './UploadStep';
import { useTest } from './useTest';

function defaultPath(status: string) {
  switch (status) {
    case 'DRAFT': return 'before';
    case 'PENDING_WASH': return 'after';
    case 'READY_TO_GRADE': return 'after/regions';
    default: return 'result';
  }
}

export function TestWorkspace() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { test, error, set } = useTest(id);
  if (error) return <ErrorBox error={error} />;
  if (!test) return <Spinner />;
  const header = (step: number, sub: string) => (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2"><span className="num">{test.reportNo}</span><StatusBadge status={test.status} /></span>}
        subtitle={`Sample ${test.sampleId}${test.customer ? ` · ${test.customer}` : ''} · ${sub}`}
      />
      <Stepper current={step} />
    </>
  );
  return (
    <Routes>
      <Route index element={<Navigate to={defaultPath(test.status)} replace />} />
      <Route path="details" element={<>{header(0, 'Edit details')}<TestDetailsForm existing={test} onSaved={(t) => { set(t); nav(`/tests/${t.id}`); }} /></>} />
      <Route path="before" element={<>{header(1, 'Before-wash upload')}<UploadStep test={test} side="before" onChange={set} /></>} />
      <Route path="before/regions" element={<>{header(2, 'Confirm regions')}<RegionsStep test={test} side="before" onChange={set} /></>} />
      <Route path="after" element={<>{header(3, 'After-wash upload')}<UploadStep test={test} side="after" onChange={set} /></>} />
      <Route path="after/regions" element={<>{header(4, 'Confirm regions and alignment')}<RegionsStep test={test} side="after" onChange={set} /></>} />
      <Route path="result" element={<ResultStep test={test} onChange={set} />} />
      <Route path="*" element={<Navigate to={defaultPath(test.status)} replace />} />
    </Routes>
  );
}
