import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { CAPTURE_GUIDELINE } from '@silkgrade/shared';
import { Button, Drawer } from '@/components/ui';
import { api } from '@/lib/api';

export function CaptureGuidelineButton() {
  const [open, setOpen] = useState(false);
  const s = useQuery({ queryKey: ['settings', 'public'], queryFn: api.publicSettings });
  const lines = s.data?.captureGuideline?.split('\n').filter(Boolean);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><BookOpen className="size-4" /> Capture guideline</Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Capture guideline">
        <ol className="space-y-3 text-sm">
          {(lines?.length ? lines.map((l, i) => ({ code: '', rule: l, why: '', k: i })) : CAPTURE_GUIDELINE.map((c, i) => ({ ...c, k: i }))).map((c) => (
            <li key={c.k} className="rounded-lg bg-[var(--surface-2)] p-3">
              {c.code && <span className="num mr-2 font-semibold">{c.code}</span>}
              {c.rule}
              {c.why && <div className="muted mt-0.5 text-xs">{c.why}</div>}
            </li>
          ))}
        </ol>
      </Drawer>
    </>
  );
}
