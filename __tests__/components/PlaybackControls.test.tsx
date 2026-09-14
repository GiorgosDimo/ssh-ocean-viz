import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PlaybackControls from '@/components/PlaybackControls';

const defaultProps = {
  isPlaying:      false,
  position:       0,
  maxPosition:    30,
  dateLabel:      'Jan 1993',
  startDateLabel: 'Jan 1993',
  endDateLabel:   'Jan 2018',
  speed:          1.0,
  speedMin:       0.1,
  speedMax:       1.0,
  onPlay:         jest.fn(),
  onPause:        jest.fn(),
  onReset:        jest.fn(),
  onSpeedChange:  jest.fn(),
  onScrubStart:   jest.fn(),
  onScrub:        jest.fn(),
  onScrubEnd:     jest.fn(),
};

describe('PlaybackControls', () => {
  it('renders Play button when not playing', () => {
    render(<PlaybackControls {...defaultProps} />);
    expect(screen.getByTitle('Play')).toBeInTheDocument();
    expect(screen.queryByTitle('Pause')).not.toBeInTheDocument();
  });

  it('renders Pause button when playing', () => {
    render(<PlaybackControls {...defaultProps} isPlaying />);
    expect(screen.getByTitle('Pause')).toBeInTheDocument();
    expect(screen.queryByTitle('Play')).not.toBeInTheDocument();
  });

  it('calls onPlay when Play is clicked', () => {
    const onPlay = jest.fn();
    render(<PlaybackControls {...defaultProps} onPlay={onPlay} />);
    fireEvent.click(screen.getByTitle('Play'));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('calls onPause when Pause is clicked', () => {
    const onPause = jest.fn();
    render(<PlaybackControls {...defaultProps} isPlaying onPause={onPause} />);
    fireEvent.click(screen.getByTitle('Pause'));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('calls onReset when Reset is clicked', () => {
    const onReset = jest.fn();
    render(<PlaybackControls {...defaultProps} onReset={onReset} />);
    fireEvent.click(screen.getByTitle('Reset to start'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('shows the current date label', () => {
    render(<PlaybackControls {...defaultProps} dateLabel="Jun 2005" />);
    expect(screen.getAllByText('Jun 2005').length).toBeGreaterThan(0);
  });

  it('shows the end date label', () => {
    render(<PlaybackControls {...defaultProps} endDateLabel="Dec 2018" />);
    expect(screen.getAllByText('Dec 2018').length).toBeGreaterThan(0);
  });

  it('shows the speed percentage', () => {
    render(<PlaybackControls {...defaultProps} speed={0.5} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('calls onSpeedChange with the correct value', () => {
    const onSpeedChange = jest.fn();
    render(<PlaybackControls {...defaultProps} onSpeedChange={onSpeedChange} />);
    // The speed slider is the last range input (scrubber is first)
    const sliders = screen.getAllByRole('slider');
    const speedSlider = sliders[sliders.length - 1];
    fireEvent.change(speedSlider, { target: { value: '50' } });
    expect(onSpeedChange).toHaveBeenCalledWith(0.5);
  });

  it('scrubber range input reflects current position', () => {
    render(<PlaybackControls {...defaultProps} position={15} maxPosition={30} />);
    const sliders = screen.getAllByRole('slider');
    const scrubber = sliders[0]; // scrubber is first
    expect(Number((scrubber as HTMLInputElement).value)).toBeCloseTo(15);
  });

  it('calls onScrub when scrubber changes', () => {
    const onScrub = jest.fn();
    render(<PlaybackControls {...defaultProps} onScrub={onScrub} />);
    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[0], { target: { value: '20' } });
    expect(onScrub).toHaveBeenCalledWith(20);
  });

  it('shows year speed range (100%–200%) for year layer', () => {
    render(<PlaybackControls {...defaultProps} speed={1.5} speedMin={1.0} speedMax={2.0} />);
    expect(screen.getByText('150%')).toBeInTheDocument();
  });
});
