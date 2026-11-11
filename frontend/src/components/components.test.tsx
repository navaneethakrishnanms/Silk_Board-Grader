/** WP8: component tests — UploadSlot, RegionEditor, GradeCard, review controls, QR fallback. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GradeDTO, ImageDTO } from '@silkgrade/shared';
import { vi } from 'vitest';

// Konva needs a real canvas; jsdom has none. Render the tree as plain elements instead.
vi.mock('react-konva', () => {
  const el = (name: string) => (p: { children?: React.ReactNode }) => <div data-konva={name}>{p.children}</div>;
  return { Stage: el('Stage'), Layer: el('Layer'), Group: el('Group'), Line: el('Line'), Circle: el('Circle'), Text: el('Text'), Image: el('Image') };
});

const { UploadSlot } = await import('./upload/UploadSlot');
const { RegionEditor } = await import('./regions/RegionEditor');
const { GradeCard, ReviewControls } = await import('./results/GradeCard');

const image: ImageDTO = {
  id: 'i1', role: 'SPECIMEN_BEFORE', side: 'before', fileName: 'spec.jpg', sizeBytes: 2_500_000, sha256: 'a'.repeat(64),
  width: 4000, height: 3000, device: 'Pixel 8', warnings: { blur: false, clipping: true, glare: false, lowRes: false, noRefCard: true },
  uploadedBy: 'u', uploadedAt: '2026-11-01T00:00:00Z', previewUrl: '/api/v1/files/x', originalUrl: '/api/v1/files/y', regions: [],
};

function grade(over: Partial<GradeDTO> = {}): GradeDTO {
  return {
    id: 'g1', kind: 'CHANGE_OVERALL', label: null, isoRating: 3.02, modelRating: null, finalRating: 3.02, halfGrade: 3, ciLow: 2.95, ciHigh: 3.1,
    confidence: 'HIGH', decision: 'REVIEW', pass: false,
    features: { dE_ab: 3.4, dE00: 3.37, dE_F: 3.37, dE_F_is_placeholder: true, dL: 3.4, dC: 0, dH: 0, p50: 3.36, p90: 3.38, review_reasons: ['PROVISIONAL'] },
    heatmapUrl: null, engineVersion: '1.0.0', modelVersion: 'formula-only', createdAt: '2026-11-01T00:00:00Z', expertGrades: [],
    effectiveGrade: 3, effectivePass: false, reviewed: false, hidden: false, ...over,
  };
}

describe('UploadSlot', () => {
  it('shows file metadata and warning chips', () => {
    render(<UploadSlot title="Specimen (unwashed)" image={image} onFile={vi.fn()} />);
    expect(screen.getByText('spec.jpg')).toBeInTheDocument();
    expect(screen.getByText('4000×3000 (12.0 MP)')).toBeInTheDocument();
    expect(screen.getByText('Pixel 8')).toBeInTheDocument();
    expect(screen.getByText('Clipped whites')).toBeInTheDocument();
    expect(screen.getByText('No reference card')).toBeInTheDocument();
  });

  it('passes a chosen file to onFile and supports drag-and-drop', async () => {
    const onFile = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<UploadSlot title="Adjacent 1" onFile={onFile} />);
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(container.querySelectorAll('input[type=file]')[0], { target: { files: [file] } });
    await waitFor(() => expect(onFile).toHaveBeenCalledWith(file));
    const zone = screen.getByText('Drop an image here').closest('div')!.parentElement!;
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(2));
  });

  it('cannot upload when disabled', () => {
    render(<UploadSlot title="Specimen" onFile={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Browse' })).toBeDisabled();
  });
});

describe('RegionEditor', () => {
  const polys = [
    { key: 'a', piece: 'SPECIMEN' as const, points: [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][] },
    { key: 'b', piece: 'ADJ1' as const, points: [[20, 0], [30, 0], [30, 10]] as [number, number][] },
  ];

  it('relabels and deletes the selected polygon', () => {
    const onChange = vi.fn();
    render(<RegionEditor width={100} height={80} polygons={polys} onChange={onChange} pieces={['SPECIMEN', 'ADJ1', 'ADJ2']} />);
    fireEvent.change(screen.getByLabelText('Piece of selected polygon'), { target: { value: 'ADJ2' } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...polys[0], piece: 'ADJ2', edited: true }, polys[1]]);
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(onChange).toHaveBeenLastCalledWith([polys[1]]);
  });

  it('enters and cancels drawing mode', () => {
    render(<RegionEditor width={100} height={80} polygons={[]} onChange={vi.fn()} pieces={['SPECIMEN']} />);
    fireEvent.click(screen.getByRole('button', { name: /Draw polygon/ }));
    expect(screen.getByRole('button', { name: 'Finish polygon' })).toBeDisabled(); // needs 3 points
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: /Draw polygon/ })).toBeInTheDocument();
  });

  it('hides editing tools when read-only', () => {
    render(<RegionEditor width={100} height={80} polygons={polys} onChange={vi.fn()} pieces={['SPECIMEN']} readOnly />);
    expect(screen.queryByRole('button', { name: /Draw polygon/ })).toBeNull();
  });
});

describe('GradeCard', () => {
  it('shows grade, interval, provisional + review badges and fail', () => {
    render(<GradeCard g={grade()} required={4} />);
    expect(screen.getByLabelText('Grade 3')).toBeInTheDocument();
    expect(screen.getByText('Provisional')).toBeInTheDocument();
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('Fail')).toBeInTheDocument();
    expect(screen.getByText(/CI 2\.95–3\.10/)).toBeInTheDocument();
  });

  it('shows the expert override next to the app grade', () => {
    render(<GradeCard g={grade({ effectiveGrade: 3.5, reviewed: true, expertGrades: [{ id: 'e', userId: 'x', userName: 'Alice', halfGrade: 3.5, reason: 'edge bleeding', blind: false, createdAt: '2026-11-01T00:00:00Z' }] })} required={4} />);
    expect(screen.getByText(/App grade 3 → expert grade/)).toBeInTheDocument();
    expect(screen.getByText(/edge bleeding/)).toBeInTheDocument();
  });

  it('hides everything in blind mode and shows the protocol step', () => {
    render(<GradeCard g={grade({ hidden: true, halfGrade: null, finalRating: null, features: null, effectiveGrade: null, blindState: 'NEEDS_C' })} required={4} />);
    expect(screen.getByText(/Grades hidden/)).toBeInTheDocument();
    expect(screen.getByText('Needs third assessor')).toBeInTheDocument();
    expect(screen.queryByText(/rating/)).toBeNull();
  });
});

describe('ReviewControls', () => {
  it('accepts the app grade', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ReviewControls g={grade()} onSubmit={onSubmit} blind={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Accept 3' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(3, undefined));
  });

  it('requires a reason to override', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ReviewControls g={grade()} onSubmit={onSubmit} blind={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Override' }));
    fireEvent.change(screen.getByLabelText('Expert grade'), { target: { value: '3.5' } });
    expect(screen.getByRole('button', { name: 'Save override' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Reason (required for an override)'), { target: { value: 'visible staining' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save override' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(3.5, 'visible staining'));
  });

  it('blind mode asks for the expert grade directly, without showing the app grade', () => {
    render(<ReviewControls g={grade({ hidden: true, halfGrade: null })} onSubmit={vi.fn()} blind />);
    expect(screen.getByRole('button', { name: 'Submit blind grade' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Accept/ })).toBeNull();
  });
});

describe('QR scan fallback', () => {
  it('uses @zxing/browser when BarcodeDetector is missing', async () => {
    vi.doMock('@zxing/browser', () => ({
      BrowserMultiFormatReader: class { decodeFromImageUrl = vi.fn().mockResolvedValue({ getText: () => ' BSB-2026-00042 ' }); },
    }));
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    const { scanCode } = await import('@/lib/scan');
    expect(await scanCode(new File(['x'], 'qr.jpg'))).toBe('BSB-2026-00042');
  });
});
