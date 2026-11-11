/** Upload slot: drag-and-drop, Browse, Take photo (phone), thumbnail, metadata, warnings. */
import { useRef, useState, type DragEvent } from 'react';
import { Camera, ImageUp, Trash2 } from 'lucide-react';
import { WARNING_LABEL, type ImageDTO, type ImageWarnings as W } from '@silkgrade/shared';
import { Badge, Button, Spinner } from '@/components/ui';
import { fileSrc } from '@/lib/api';
import { cn, fmtBytes } from '@/lib/utils';

const ACCEPT = 'image/jpeg,image/png,image/tiff,image/heic,image/heif,.heic,.heif,.tif,.tiff';

export function ImageWarnings({ warnings, hideRefCard }: { warnings: W; hideRefCard?: boolean }) {
  const on = Object.entries(warnings).filter(([k, v]) => v && !(hideRefCard && k === 'noRefCard'));
  if (!on.length) return <Badge tone="slate">No warnings</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      {on.map(([k]) => (
        <Badge key={k} tone={k === 'noRefCard' ? 'neutral' : 'amber'}>{WARNING_LABEL[k] ?? k}</Badge>
      ))}
    </span>
  );
}

export function UploadSlot({ title, hint, image, onFile, onDelete, disabled, optional }: {
  title: string; hint?: string; image?: ImageDTO; onFile: (f: File) => Promise<unknown>; onDelete?: () => Promise<unknown>; disabled?: boolean; optional?: boolean;
}) {
  const browse = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  async function handle(f: File | undefined) {
    if (!f || disabled) return;
    setBusy(true);
    try { await onFile(f); } finally { setBusy(false); }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); void handle(e.dataTransfer.files[0]); };

  return (
    <div className="surface flex flex-col rounded-xl">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <div>
          <div className="text-sm font-medium">{title}{optional && <span className="muted font-normal"> (optional)</span>}</div>
          {hint && <div className="muted text-xs">{hint}</div>}
        </div>
        {image && onDelete && !disabled && (
          <Button variant="ghost" size="sm" aria-label={`Remove ${title}`} onClick={async () => { setBusy(true); try { await onDelete(); } finally { setBusy(false); } }}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn('booth relative m-3 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg', drag && 'ring-2 ring-[var(--focus)]')}
      >
        {busy ? <Spinner className="text-white" /> : image?.previewUrl ? (
          <img src={fileSrc(image.previewUrl)} alt={title} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-1 p-4 text-center text-sm text-white/90">
            <ImageUp className="size-7" aria-hidden />
            <span>Drop an image here</span>
            <span className="text-xs text-white/70">JPEG, PNG, TIFF, HEIC · max 40 MB</span>
          </div>
        )}
      </div>
      {image && (
        <dl className="num grid grid-cols-2 gap-x-3 gap-y-0.5 px-3 text-[11px]">
          <dt className="muted">File</dt><dd className="truncate" title={image.fileName ?? ''}>{image.fileName ?? '—'}</dd>
          <dt className="muted">Size</dt><dd>{fmtBytes(image.sizeBytes)}</dd>
          <dt className="muted">Resolution</dt><dd>{image.width}×{image.height} ({((image.width * image.height) / 1e6).toFixed(1)} MP)</dd>
          <dt className="muted">Device</dt><dd className="truncate">{image.device ?? '—'}</dd>
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-2 p-3">
        {image && <ImageWarnings warnings={image.warnings} />}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => browse.current?.click()}>Browse</Button>
          <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => camera.current?.click()} className="md:hidden">
            <Camera className="size-4" /> Take photo
          </Button>
        </div>
        <input ref={browse} type="file" accept={ACCEPT} hidden onChange={(e) => { void handle(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void handle(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </div>
  );
}
