import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ColorPicker from '@/components/ColorPicker';

describe('ColorPicker', () => {
  it('renders both colormap options', () => {
    render(<ColorPicker value="Spectral" onChange={jest.fn()} />);
    expect(screen.getByTitle('Spectral')).toBeInTheDocument();
    expect(screen.getByTitle('RdBu')).toBeInTheDocument();
  });

  it('highlights the active colormap with a border', () => {
    render(<ColorPicker value="Spectral" onChange={jest.fn()} />);
    const activeBtn  = screen.getByTitle('Spectral');
    const inactiveBtn = screen.getByTitle('RdBu');
    expect(activeBtn.className).toContain('border-blue-500');
    expect(inactiveBtn.className).not.toContain('border-blue-500');
  });

  it('calls onChange with "RdBu" when RdBu is clicked', () => {
    const onChange = jest.fn();
    render(<ColorPicker value="Spectral" onChange={onChange} />);
    fireEvent.click(screen.getByTitle('RdBu'));
    expect(onChange).toHaveBeenCalledWith('RdBu');
  });

  it('calls onChange with "Spectral" when Spectral is clicked', () => {
    const onChange = jest.fn();
    render(<ColorPicker value="RdBu" onChange={onChange} />);
    fireEvent.click(screen.getByTitle('Spectral'));
    expect(onChange).toHaveBeenCalledWith('Spectral');
  });

  it('shows gradient swatches in each button', () => {
    const { container } = render(<ColorPicker value="Spectral" onChange={jest.fn()} />);
    const swatches = container.querySelectorAll('[style*="background"]');
    expect(swatches.length).toBeGreaterThanOrEqual(2);
  });

  it('shows label text for each colormap', () => {
    render(<ColorPicker value="Spectral" onChange={jest.fn()} />);
    expect(screen.getByText('Spectral')).toBeInTheDocument();
    expect(screen.getByText('RdBu')).toBeInTheDocument();
  });
});
