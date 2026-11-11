import { render, screen } from '@testing-library/react';
import { GradeChip, GradeScale, PassBadge } from './GradeBits';

describe('GradeChip', () => {
  it('shows the grade as text with its colour', () => {
    render(<GradeChip grade={4.5} />);
    const chip = screen.getByLabelText('Grade 4-5');
    expect(chip).toHaveTextContent('4-5');
    expect(chip.className).toContain('bg-green-600');
  });
  it('renders a dash when hidden', () => {
    render(<GradeChip grade={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('PassBadge', () => {
  it('labels pass and fail', () => {
    const { rerender } = render(<PassBadge pass />);
    expect(screen.getByText('Pass')).toBeInTheDocument();
    rerender(<PassBadge pass={false} />);
    expect(screen.getByText('Fail')).toBeInTheDocument();
  });
});

describe('GradeScale', () => {
  it('describes the rating and interval for screen readers', () => {
    render(<GradeScale rating={3.02} ciLow={2.9} ciHigh={3.1} />);
    expect(screen.getByLabelText('Rating 3.02, interval 2.90 to 3.10')).toBeInTheDocument();
  });
});
