import React from 'react';
import { render, screen } from '@testing-library/react';
import SshReadout from '@/components/SshReadout';

describe('SshReadout', () => {
  it('renders nothing when value is null', () => {
    const { container } = render(<SshReadout value={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the SSH value when provided', () => {
    render(<SshReadout value="+0.42 m" />);
    expect(screen.getByText('+0.42 m')).toBeInTheDocument();
  });

  it('renders the SSH label', () => {
    render(<SshReadout value="+0.42 m" />);
    expect(screen.getByText('SSH')).toBeInTheDocument();
  });

  it('displays negative values correctly', () => {
    render(<SshReadout value="-0.75 m" />);
    expect(screen.getByText('-0.75 m')).toBeInTheDocument();
  });

  it('renders nothing when value changes back to null', () => {
    const { rerender, container } = render(<SshReadout value="+0.50 m" />);
    expect(container.firstChild).not.toBeNull();
    rerender(<SshReadout value={null} />);
    expect(container.firstChild).toBeNull();
  });
});
