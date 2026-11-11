import { useEffect, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button, ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { download, request } from '@/lib/api';

/** S16 — in-app PDF preview (fetched with the auth header, shown from a blob URL). */
export function ReportPreviewPage() {
  const { id = '' } = useParams();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let revoke: string | null = null;
    request<Response>(`/tests/${id}/report.pdf`, { raw: true })
      .then((r) => r.blob())
      .then((b) => { revoke = URL.createObjectURL(b); setUrl(revoke); })
      .catch(setError);
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [id]);
  return (
    <>
      <PageHeader
        title="Report preview"
        actions={<>
          <Link to={`/tests/${id}`}><Button variant="outline"><ArrowLeft className="size-4" /> Back to result</Button></Link>
          <Button onClick={() => download(`/tests/${id}/report.pdf?download=1`, 'report.pdf')}><Download className="size-4" /> Download PDF</Button>
        </>}
      />
      <ErrorBox error={error} />
      {!url && !error ? <Spinner /> : url && <iframe title="Report PDF" src={url} className="h-[80vh] w-full rounded-lg border border-[var(--border)] bg-white" />}
    </>
  );
}
