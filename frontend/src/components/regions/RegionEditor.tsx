/** Konva polygon editor. Coordinates are ORIGINAL image pixels; the preview
 *  image (downscaled JPEG) is stretched to the original size so polygons map 1:1. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Image as KImage, Layer, Line, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import { Maximize2, PenLine, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import type { Piece } from '@silkgrade/shared';
import { Button, Select } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface EditablePolygon {
  key: string;
  piece: Piece;
  points: [number, number][];
  confidence?: number;
  edited?: boolean;
}

export const PIECE_COLOUR: Record<Piece, string> = { SPECIMEN: '#2563eb', ADJ1: '#16a34a', ADJ2: '#d97706', REF_CARD: '#c026d3' };
export const PIECE_LABEL: Record<Piece, string> = { SPECIMEN: 'Specimen', ADJ1: 'Adjacent 1', ADJ2: 'Adjacent 2', REF_CARD: 'Reference card' };

function useImage(src?: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return;
    const i = new window.Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);
  return img;
}

let keySeq = 0;
export const newKey = () => `p${Date.now()}-${keySeq++}`;

export function RegionEditor({ src, width, height, polygons, onChange, pieces, readOnly }: {
  src?: string; width: number; height: number; polygons: EditablePolygon[]; onChange: (p: EditablePolygon[]) => void; pieces: Piece[]; readOnly?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(polygons[0]?.key ?? null);
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const [drawPiece, setDrawPiece] = useState<Piece>(pieces[0]);
  const img = useImage(src);

  useEffect(() => {
    if (!wrap.current) return;
    setBoxW(wrap.current.clientWidth || 600);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setBoxW(e.contentRect.width));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const fit = boxW / width;
  const boxH = Math.min(Math.round(height * fit), typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.65) : 600);
  const fitScale = Math.min(fit, boxH / height);
  const k = fitScale * zoom;
  const handle = 7 / k;

  const sel = useMemo(() => polygons.find((p) => p.key === selected) ?? null, [polygons, selected]);
  const update = (key: string, fn: (p: EditablePolygon) => EditablePolygon) => onChange(polygons.map((p) => (p.key === key ? fn(p) : p)));
  const clamp = (x: number, y: number): [number, number] => [Math.round(Math.min(width, Math.max(0, x))), Math.round(Math.min(height, Math.max(0, y)))];

  function stagePoint(stage: Konva.Stage): [number, number] | null {
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return clamp((pos.x - pan.x) / k, (pos.y - pan.y) / k);
  }

  function onStageClick(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!drawing || readOnly) return;
    const p = stagePoint(e.target.getStage()!);
    if (!p) return;
    if (drawing.length >= 3) {
      const [fx, fy] = drawing[0];
      if (Math.hypot(fx - p[0], fy - p[1]) < handle * 2) return finish();
    }
    setDrawing([...drawing, p]);
  }

  function finish() {
    if (!drawing || drawing.length < 3) return setDrawing(null);
    const poly: EditablePolygon = { key: newKey(), piece: drawPiece, points: drawing, edited: true };
    onChange([...polygons, poly]);
    setSelected(poly.key);
    setDrawing(null);
  }

  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = e.target.getStage()!;
    const pos = stage.getPointerPosition() ?? { x: boxW / 2, y: boxH / 2 };
    const nz = Math.min(8, Math.max(1, zoom * (e.evt.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const nk = fitScale * nz;
    const ix = (pos.x - pan.x) / k;
    const iy = (pos.y - pan.y) / k;
    setZoom(nz);
    setPan(nz === 1 ? { x: 0, y: 0 } : { x: pos.x - ix * nk, y: pos.y - iy * nk });
  }

  return (
    <div className="space-y-2">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          {drawing ? (
            <>
              <span className="text-sm">Click to add points ({drawing.length}); click the first point or</span>
              <Button size="sm" onClick={finish} disabled={drawing.length < 3}>Finish polygon</Button>
              <Button size="sm" variant="ghost" onClick={() => setDrawing(null)}>Cancel</Button>
            </>
          ) : (
            <>
              <Select aria-label="Piece for new polygon" className="h-8 w-40" value={drawPiece} onChange={(e) => setDrawPiece(e.target.value as Piece)}>
                {pieces.map((p) => <option key={p} value={p}>{PIECE_LABEL[p]}</option>)}
              </Select>
              <Button size="sm" variant="outline" onClick={() => { setDrawing([]); setSelected(null); }}><PenLine className="size-4" /> Draw polygon</Button>
              {sel && (
                <>
                  <Select aria-label="Piece of selected polygon" className="h-8 w-40" value={sel.piece} onChange={(e) => update(sel.key, (p) => ({ ...p, piece: e.target.value as Piece, edited: true }))}>
                    {pieces.map((p) => <option key={p} value={p}>{PIECE_LABEL[p]}</option>)}
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => { onChange(polygons.filter((p) => p.key !== sel.key)); setSelected(null); }}>
                    <Trash2 className="size-4" /> Delete
                  </Button>
                </>
              )}
            </>
          )}
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(8, z * 1.25))}><ZoomIn className="size-4" /></Button>
            <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => { const z = Math.max(1, zoom / 1.25); setZoom(z); if (z === 1) setPan({ x: 0, y: 0 }); }}><ZoomOut className="size-4" /></Button>
            <Button size="sm" variant="ghost" aria-label="Reset view" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><Maximize2 className="size-4" /></Button>
          </div>
        </div>
      )}
      <div ref={wrap} className={cn('booth w-full overflow-hidden rounded-lg', drawing && 'cursor-crosshair')}>
        <Stage
          width={boxW}
          height={boxH}
          onClick={onStageClick}
          onTap={onStageClick}
          onWheel={onWheel}
          draggable={zoom > 1 && !drawing}
          x={pan.x}
          y={pan.y}
          onDragEnd={(e) => { if (e.target === e.target.getStage()) setPan({ x: e.target.x(), y: e.target.y() }); }}
        >
          <Layer scaleX={k} scaleY={k}>
            {img && <KImage image={img} width={width} height={height} />}
            {polygons.map((p) => {
              const c = PIECE_COLOUR[p.piece];
              const isSel = p.key === selected;
              const [lx, ly] = p.points[0] ?? [0, 0];
              return (
                <Group key={p.key} onClick={(e) => { if (!drawing) { e.cancelBubble = true; setSelected(p.key); } }} onTap={(e) => { if (!drawing) { e.cancelBubble = true; setSelected(p.key); } }}>
                  <Line points={p.points.flat()} closed stroke={c} strokeWidth={(isSel ? 3 : 2) / k} fill={`${c}33`} />
                  <Text x={lx + 6 / k} y={ly + 6 / k} text={`${PIECE_LABEL[p.piece]}${p.confidence !== undefined ? ` ${Math.round(p.confidence * 100)}%` : ''}`} fontSize={13 / k} fill="#fff" padding={3 / k} />
                  {isSel && !readOnly && p.points.map(([x, y], i) => (
                    <Circle
                      key={i}
                      x={x}
                      y={y}
                      radius={handle}
                      fill="#fff"
                      stroke={c}
                      strokeWidth={2 / k}
                      draggable
                      onDragMove={(e) => {
                        const np = clamp(e.target.x(), e.target.y());
                        update(p.key, (q) => ({ ...q, edited: true, points: q.points.map((pt, j) => (j === i ? np : pt)) }));
                      }}
                    />
                  ))}
                </Group>
              );
            })}
            {drawing && drawing.length > 0 && (
              <>
                <Line points={drawing.flat()} stroke={PIECE_COLOUR[drawPiece]} strokeWidth={2 / k} dash={[6 / k, 4 / k]} />
                {drawing.map(([x, y], i) => <Circle key={i} x={x} y={y} radius={handle * 0.8} fill={PIECE_COLOUR[drawPiece]} />)}
              </>
            )}
          </Layer>
        </Stage>
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {pieces.map((p) => (
          <span key={p} className="flex items-center gap-1"><span className="size-3 rounded-sm" style={{ background: PIECE_COLOUR[p] }} /> {PIECE_LABEL[p]}</span>
        ))}
        <span className="muted">Select a polygon to drag its corners · scroll to zoom · drag to pan when zoomed</span>
      </div>
    </div>
  );
}
