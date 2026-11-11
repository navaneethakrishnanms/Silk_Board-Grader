/** S4 / S7 — before / after-wash upload. */
import { AlertTriangle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { Side, TestDTO } from '@silkgrade/shared';
import { CaptureGuidelineButton } from '@/components/upload/CaptureGuideline';
import { UploadSlot } from '@/components/upload/UploadSlot';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/utils';
import { imageFor, slotsFor } from './useTest';

export function UploadStep({ test, side, onChange }: { test: TestDTO; side: Side; onChange: (t: TestDTO) => void }) {
  const nav = useNavigate();
  const editable = side === 'before' ? test.status === 'DRAFT' : ['PENDING_WASH', 'READY_TO_GRADE'].includes(test.status);
  const slots = slotsFor(test, side);
  const required = slots.filter((s) => !s.optional);
  const ready = required.every((s) => imageFor(test, s.role, side));

  const devices = (s: Side) => new Set(test.images.filter((i) => i.side === s && i.device).map((i) => i.device));
  const before = devices('before');
  const deviceMismatch = side === 'after' && [...devices('after')].some((d) => before.size && !before.has(d));

  return (
    <div className="space-y-4">
      {!editable && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm">
          {side === 'before' ? 'Before-wash images are locked.' : 'Save the before-wash set first.'}{' '}
          <Link className="underline" to={`/tests/${test.id}`}>Go to the current step</Link>
        </div>
      )}
      {deviceMismatch && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          The after-wash images come from a different device than the before-wash images ({[...before].join(', ')}). Colour can differ between cameras — results will go to review.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="muted text-sm">
          {test.uploadMode === 'single' ? 'One photo with all pieces.' : 'One photo per piece.'} Upload mode can be changed in <Link className="underline" to={`/tests/${test.id}/details`}>details</Link>.
        </p>
        <CaptureGuidelineButton />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {slots.map((s) => {
          const img = imageFor(test, s.role, side);
          return (
            <UploadSlot
              key={s.role}
              title={s.title}
              hint={s.hint}
              optional={s.optional}
              image={img}
              disabled={!editable}
              onFile={async (f) => {
                try { onChange(await api.uploadImage(test.id, s.role, f, side)); toast.ok(`${s.title} uploaded`); } catch (e) { toast.error(e); }
              }}
              onDelete={img ? async () => { try { onChange(await api.deleteImage(test.id, img.id)); } catch (e) { toast.error(e); } } : undefined}
            />
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        {side === 'before' && <Link to={`/tests/${test.id}/details`}><Button variant="outline">Edit details</Button></Link>}
        <Button size="lg" disabled={!ready || !editable} onClick={() => nav(`/tests/${test.id}/${side}/regions`)}>Next: confirm regions</Button>
      </div>
    </div>
  );
}
