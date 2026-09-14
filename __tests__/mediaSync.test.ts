import { mediaSync } from '@/lib/mediaSync';
import { TimingObject } from '@/lib/TimingObject';

/** Minimal HTMLVideoElement stub */
function makeVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  return {
    currentTime:  0,
    playbackRate: 1,
    paused:       true,
    play:  jest.fn().mockResolvedValue(undefined),
    pause: jest.fn(),
    addEventListener:    jest.fn(),
    removeEventListener: jest.fn(),
    ...overrides,
  } as unknown as HTMLVideoElement;
}

describe('mediaSync', () => {
  it('seeks video to timing-object position on creation', () => {
    const to    = new TimingObject({ range: [0, 30] });
    to.update({ position: 10 });
    const video = makeVideo({ currentTime: 0 });
    mediaSync(video, to);
    expect(video.currentTime).toBe(10); // target = position × speedRatio(1) = 10
    to.destroy();
  });

  it('plays video when timing velocity > 0', () => {
    const to    = new TimingObject({ range: [0, 30] });
    to.update({ velocity: 1 });
    const video = makeVideo({ currentTime: 0 });
    mediaSync(video, to);
    expect(video.play).toHaveBeenCalled();
    to.destroy();
  });

  it('pauses video when timing velocity = 0', () => {
    const to    = new TimingObject({ range: [0, 30] });
    to.update({ velocity: 0 });
    const video = makeVideo({ paused: false }); // starts un-paused
    mediaSync(video, to);
    expect(video.pause).toHaveBeenCalled();
    to.destroy();
  });

  it('applies speedRatio to the target time', () => {
    const to    = new TimingObject({ range: [0, 30] });
    to.update({ position: 10 });
    const video = makeVideo({ currentTime: 0 });
    mediaSync(video, to, { speedRatio: 0.5 });
    expect(video.currentTime).toBe(5); // 10 × 0.5
    to.destroy();
  });

  it('does not seek when within tolerance', () => {
    const to    = new TimingObject({ range: [0, 30] });
    to.update({ position: 5 });
    const video = makeVideo({ currentTime: 5.05 }); // within default tolerance 0.1
    mediaSync(video, to);
    expect(video.currentTime).toBeCloseTo(5.05, 2); // unchanged
    to.destroy();
  });

  it('re-syncs on subsequent timeupdate events', () => {
    const to    = new TimingObject({ range: [0, 30] });
    to.update({ velocity: 1 });
    const video = makeVideo({ currentTime: 0 });
    mediaSync(video, to);

    // Simulate drift: position advances but video didn't
    to.update({ position: 20 });
    // The timingObject.on('timeupdate', sync) handler re-runs sync
    expect(video.currentTime).toBeCloseTo(20, 0);
    to.destroy();
  });

  it('destroy() removes the timeupdate listener', () => {
    const to    = new TimingObject({ range: [0, 30] });
    const video = makeVideo({ currentTime: 0 });
    const handle = mediaSync(video, to);

    handle.destroy();

    // Reset mocks, then fire timeupdate — play/pause/seek should not be called
    (video.play  as jest.Mock).mockClear();
    (video.pause as jest.Mock).mockClear();
    const seekBefore = video.currentTime;

    to.update({ velocity: 1, position: 15 }); // fires timeupdate
    // After destroy, the sync callback should have been removed
    expect(video.currentTime).toBe(seekBefore); // no seek
    to.destroy();
  });
});
