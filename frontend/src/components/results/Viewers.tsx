import { useState } from 'react';
import { cn } from '@/lib/utils';

/** Before/after overlay slider (also used to check alignment in S8). */
export function BeforeAfterSlider({ before, after, labels = ['Before', 'After'], className }: { before?: string; after?: string; labels?: [string, string]; className?: string }) {
  const [pos, setPos] = useState(50);
  if (!before || !after) return <div className="booth flex aspect-[4/3] items-center justify-center rounded-lg text-sm text-white/80">Images not available</div>;
  return (
    <div className={cn('space-y-2', className)}>
      <div className="booth relative aspect-[4/3] w-full select-none overflow-hidden rounded-lg">
        <img src={after} alt={labels[1]} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <img src={before} alt={labels[0]} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
        </div>
        <div className="absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }} />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{labels[0]}</span>
        <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{labels[1]}</span>
      </div>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="w-full" aria-label="Before/after position" />
    </div>
  );
}

export function ImagePanel({ src, alt, caption }: { src?: string | null; alt: string; caption?: string }) {
  return (
    <figure className="space-y-1">
      <div className="booth flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg">
        {src ? <img src={src} alt={alt} className="max-h-full max-w-full object-contain" /> : <span className="text-sm text-white/80">Not available</span>}
      </div>
      {caption && <figcaption className="muted text-xs">{caption}</figcaption>}
    </figure>
  );
}
