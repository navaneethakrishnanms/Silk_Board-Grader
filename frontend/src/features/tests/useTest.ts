import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImageDTO, ImageRole, Piece, Side, TestDTO } from '@silkgrade/shared';
import { api } from '@/lib/api';

export function useTest(id: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['test', id],
    queryFn: () => api.test(id),
    refetchInterval: (query) => (query.state.data?.status === 'GRADING' ? 1500 : false),
  });
  const set = (t: TestDTO) => {
    qc.setQueryData(['test', id], t);
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['tests'] });
  };
  return { ...q, test: q.data, set };
}

export interface Slot { role: ImageRole; title: string; hint?: string; optional?: boolean; pieces: Piece[] }

export function slotsFor(t: TestDTO, side: Side): Slot[] {
  const S = side.toUpperCase() as 'BEFORE' | 'AFTER';
  const card: Slot = { role: 'REF_CARD', title: 'Reference card', hint: 'Colour checker, 4 corners', optional: true, pieces: ['REF_CARD'] };
  const fabric: Piece[] = t.adjCount > 1 ? ['SPECIMEN', 'ADJ1', 'ADJ2'] : ['SPECIMEN', 'ADJ1'];
  if (t.uploadMode === 'single') {
    return [{ role: `COMPOSITE_${S}` as ImageRole, title: `All pieces — ${side} wash`, hint: 'Specimen + adjacent fabrics in one photo, with gaps', pieces: [...fabric, 'REF_CARD'] }, card];
  }
  const word = side === 'before' ? 'unwashed' : 'washed';
  const slots: Slot[] = [
    { role: `SPECIMEN_${S}` as ImageRole, title: `Specimen (${word})`, pieces: ['SPECIMEN'] },
    { role: `ADJ1_${S}` as ImageRole, title: `Adjacent 1 — ${t.adj1Fibre} (${word})`, pieces: ['ADJ1'] },
  ];
  if (t.adjCount > 1) slots.push({ role: `ADJ2_${S}` as ImageRole, title: `Adjacent 2 — ${t.adj2Fibre ?? ''} (${word})`, pieces: ['ADJ2'] });
  return [...slots, card];
}

export const imageFor = (t: TestDTO, role: ImageRole, side: Side): ImageDTO | undefined =>
  t.images.find((i) => i.role === role && i.side === side);

export const sideImages = (t: TestDTO, side: Side) => t.images.filter((i) => i.side === side);

/** Specimen image for a side (dedicated slot or composite). */
export function specimenImage(t: TestDTO, side: Side): ImageDTO | undefined {
  return t.images.find((i) => i.side === side && i.regions.some((r) => r.piece === 'SPECIMEN'))
    ?? t.images.find((i) => i.side === side && (i.role.startsWith('SPECIMEN') || i.role.startsWith('COMPOSITE')));
}

export function pieceImage(t: TestDTO, piece: Piece, side: Side): ImageDTO | undefined {
  return t.images.find((i) => i.side === side && i.regions.some((r) => r.piece === piece));
}
