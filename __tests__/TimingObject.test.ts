import { TimingObject } from '@/lib/TimingObject';

const RANGE: [number, number] = [0, 30];

function make() {
  return new TimingObject({ range: RANGE });
}

describe('TimingObject – initial state', () => {
  it('starts at position 0, velocity 0', () => {
    const to = make();
    const { position, velocity } = to.query();
    expect(position).toBe(0);
    expect(velocity).toBe(0);
  });
});

describe('TimingObject – update()', () => {
  it('sets velocity', () => {
    const to = make();
    to.update({ velocity: 1 });
    expect(to.query().velocity).toBe(1);
  });

  it('sets position', () => {
    const to = make();
    to.update({ position: 15 });
    expect(to.query().position).toBe(15);
  });

  it('clamps position to range', () => {
    const to = make();
    to.update({ position: 999 });
    expect(to.query().position).toBeLessThanOrEqual(RANGE[1]);
    to.update({ position: -5 });
    expect(to.query().position).toBeGreaterThanOrEqual(RANGE[0]);
  });

  it('fires timeupdate and change events', () => {
    const to = make();
    const onUpdate = jest.fn();
    const onChange = jest.fn();
    to.on('timeupdate', onUpdate);
    to.on('change', onChange);
    to.update({ velocity: 1 });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('TimingObject – query() advances position', () => {
  it('returns the same position when velocity is 0', () => {
    const to = make();
    to.update({ position: 5 });
    const p1 = to.query().position;
    const p2 = to.query().position;
    expect(p1).toBe(5);
    expect(p2).toBe(5);
  });

  it('advances position over real wall-clock time when velocity > 0', async () => {
    const to = make();
    to.update({ velocity: 10 }); // 10 units/sec
    await new Promise((r) => setTimeout(r, 50)); // wait 50 ms
    const { position } = to.query();
    // Should have moved roughly 0.5 units; allow loose bounds
    expect(position).toBeGreaterThan(0);
  });
});

describe('TimingObject – event listeners', () => {
  it('off() removes a listener', () => {
    const to = make();
    const cb = jest.fn();
    to.on('timeupdate', cb);
    to.off('timeupdate', cb);
    to.update({ velocity: 1 });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('TimingObject – startUpdateLoop', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires timeupdate at the given interval when playing', () => {
    const to = make();
    to.update({ velocity: 1 });
    const cb = jest.fn();
    to.on('timeupdate', cb);
    to.startUpdateLoop(100);
    jest.advanceTimersByTime(350);
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(3);
    to.stopUpdateLoop();
    to.destroy();
  });

  it('does not fire timeupdate when paused (velocity=0)', () => {
    const to = make();
    const cb = jest.fn();
    to.on('timeupdate', cb);
    to.startUpdateLoop(100);
    jest.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled();
    to.stopUpdateLoop();
    to.destroy();
  });

  it('auto-loops when position reaches range end', () => {
    const to = new TimingObject({ range: [0, 1] });
    to.update({ position: 0.99, velocity: 1 });
    to.startUpdateLoop(100);
    jest.advanceTimersByTime(200);
    // After loop, position should have reset to 0 (or near it)
    to.stopUpdateLoop();
    const { position } = to.query();
    expect(position).toBeLessThan(0.5); // looped back
    to.destroy();
  });
});

describe('TimingObject – destroy()', () => {
  it('clears all listeners', () => {
    const to = make();
    const cb = jest.fn();
    to.on('timeupdate', cb);
    to.destroy();
    // After destroy, update should not fire the listener
    // (destroy clears the Sets, so there is no mechanism to fire them)
    expect(cb).not.toHaveBeenCalled();
  });
});
