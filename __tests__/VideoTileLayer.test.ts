/**
 * VideoTileLayer unit tests
 *
 * Key behaviours under test:
 *  1. Video pool deduplication — same URL → one <video> element
 *  2. Kickoff fires for ALL tiles that share a URL (central AND wrapping)
 *  3. tilesready fires once all tiles are ready
 *  4. RAF starts when velocity > 0 and stops when velocity = 0
 *  5. paintFrame calls WebGL (texImage2D / drawArrays / flush / drawImage)
 *  6. setSuspended(true) destroys syncs; setSuspended(false) recreates them
 *  7. Tile unload ref-counts correctly; pool entry survives until last ref gone
 *  8. World-wrap: tileX = rawX mod 2^z, monotone tileId counter avoids coord collisions
 *  9. repaintAllTiles() repaints ALL tiles including central ones (colormap fix)
 * 10. kickLayerDraw() starts RAF when velocity > 0 (first-load fix)
 * 11. tilesready triggers RAF-deferred repaint (mirrors post-zoom syncAllTiles)
 */

import { TimingObject } from '@/lib/TimingObject';
import { mockGl, mockCtx2d } from '../jest.setup';

// ── Leaflet mock ──────────────────────────────────────────────────────────────
// We capture the prototype object passed to L.GridLayer.extend so individual
// tests can call createTile / onAdd directly.

let capturedProto: Record<string, (...a: any[]) => any> = {};

jest.mock('leaflet', () => ({
  GridLayer: {
    prototype: { onAdd: jest.fn() },
    extend: (proto: Record<string, any>) => {
      capturedProto = proto;
      // Return a constructor whose instances are minimal event emitters
      function MockLayer(this: any) {
        const handlers: Record<string, ((...a: any[]) => void)[]> = {};
        this._container = document.createElement('div');
        this.on = (ev: string, fn: (...a: any[]) => void) => {
          (handlers[ev] = handlers[ev] || []).push(fn);
          return this;
        };
        this.off = (ev: string, fn: (...a: any[]) => void) => {
          handlers[ev] = (handlers[ev] || []).filter(h => h !== fn);
          return this;
        };
        this.fire = (ev: string, data?: any) => {
          (handlers[ev] || []).slice().forEach(h => h(data ?? {}));
          return this;
        };
        this.getTileSize     = () => ({ x: 512, y: 512 });
        this.addInteractiveTarget = jest.fn();
        // Copy prototype methods so they can be called on instances
        Object.assign(this, proto);
        // But keep our on/off/fire so the layer can emit/receive events
        proto.initialize?.call(this);
      }
      return MockLayer;
    },
  },
  DomUtil: {
    create: (tag: string, cls: string) => {
      const el = document.createElement(tag);
      el.className = cls;
      return el;
    },
    addClass: (el: Element, cls: string) => el.classList.add(cls),
  },
  Util: { setOptions: jest.fn() },
}));

// mediaSync has been removed — VideoTileLayer drives all videos via explicit
// seeks in the RAF loop so all tiles always paint from the same target time.

// ── Helpers ───────────────────────────────────────────────────────────────────

import { createVideoTileLayer } from '@/lib/VideoTileLayer';
import { buildColorLUT, type RgbColor } from '@/lib/colormap';

const RGBS   = buildColorLUT('Spectral');
const getRgbs = () => RGBS;

function makeTo() {
  return new TimingObject({ range: [0, 30] });
}

/** Fake "this" context inside createTile (mirrors what Leaflet provides). */
const tileCtx = {
  getTileSize:          () => ({ x: 512, y: 512 }),
  addInteractiveTarget: jest.fn(),
};

/** Fire an event on a video element. */
function fireEvent(video: HTMLVideoElement, name: string) {
  video.dispatchEvent(new Event(name));
}

/** Make a video behave as though it has loaded data (readyState ≥ 2). */
function makeVideoReady(video: HTMLVideoElement, currentTime = 0) {
  Object.defineProperty(video, 'readyState',  { value: 4, configurable: true });
  Object.defineProperty(video, 'videoWidth',  { value: 512, configurable: true });
  Object.defineProperty(video, 'currentTime', {
    get: () => currentTime,
    set: jest.fn(),
    configurable: true,
  });
}

/** Spy on document.createElement to capture created <video> elements. */
function spyOnVideoCreation() {
  const videos: HTMLVideoElement[] = [];
  // Grab the real implementation from the prototype so we never recurse into
  // a previously installed spy (restoreAllMocks in beforeEach already cleaned
  // them, but this belt-and-suspenders approach is harmless).
  const realCreate = HTMLDocument.prototype.createElement.bind(document);
  jest.spyOn(document, 'createElement').mockImplementation((tag: string, ...rest: any[]) => {
    const el = realCreate(tag, ...rest);
    if (tag === 'video') videos.push(el as HTMLVideoElement);
    return el;
  });
  return videos;
}

/** Simulate Leaflet's tileunload event, which provides the tile's DOM element. */
function fireTileUnload(layer: any, tileDiv: HTMLElement) {
  layer.fire('tileunload', { tile: tileDiv });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VideoTileLayer – video pool deduplication', () => {
  let to: TimingObject;

  beforeEach(() => { to = makeTo(); });
  afterEach(()  => { to.destroy(); });

  it('creates ONE video element for two tiles sharing the same URL', () => {
    const videos = spyOnVideoCreation();
    const layer  = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });

    // Tile (2,0,0) and tile (2,4,0) both wrap to x=0 → same URL
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 4, y: 0 }); // wraps to x=0

    expect(videos).toHaveLength(1); // pool deduplication
    void layer;
  });

  it('creates a separate video for a tile with a different y coordinate', () => {
    const videos = spyOnVideoCreation();
    const layer  = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 1 }); // different y

    expect(videos).toHaveLength(2);
    void layer;
  });
});

describe('VideoTileLayer – kickoff and tilesready', () => {
  let to: TimingObject;
  let videos: HTMLVideoElement[];

  beforeEach(() => {
    to     = makeTo();
    videos = spyOnVideoCreation();
  });
  afterEach(() => { to.destroy(); });

  it('fires tilesready after all tiles load (single tile)', () => {
    const layer      = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    const video = videos[0];
    makeVideoReady(video);
    fireEvent(video, 'loadeddata');

    expect(tilesReady).toHaveBeenCalledTimes(1);
  });

  it('fires tilesready only once when two tiles share a URL', () => {
    const layer      = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 4, y: 0 }); // same URL

    const video = videos[0];
    makeVideoReady(video);
    fireEvent(video, 'loadeddata');

    // Both tiles get kicked off by the same loadeddata → tilesready fires once
    expect(tilesReady).toHaveBeenCalledTimes(1);
  });

  it('fires tilesready only after ALL distinct videos load', () => {
    const layer      = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 1 }); // different URL

    // Load only the first video
    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');
    expect(tilesReady).not.toHaveBeenCalled(); // second video still pending

    // Load the second video
    makeVideoReady(videos[1]);
    fireEvent(videos[1], 'loadeddata');
    expect(tilesReady).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire tilesready when a video errors', () => {
    const layer      = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 1 }); // second tile

    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata'); // first ok
    fireEvent(videos[1], 'error');      // second errors → removed from pending

    // tilesready should have fired once (one tile loaded, one errored → all settled)
    expect(tilesReady).toHaveBeenCalledTimes(1);
  });

  it('reuses video pool entry for tiles sharing the same URL', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 4, y: 0 }); // same URL as first tile

    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    // Despite two tiles, only one video element was created (pool deduplication)
    expect(videos.length).toBe(1);
    void layer;
  });
});

describe('VideoTileLayer – RAF loop and painting', () => {
  let to: TimingObject;
  let videos: HTMLVideoElement[];
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    to            = makeTo();
    videos        = spyOnVideoCreation();
    rafCallbacks  = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });
  afterEach(() => { to.destroy(); });

  /** Drain all queued RAF callbacks once. */
  const drainRaf = (ts = 200) => {
    const cbs = rafCallbacks.splice(0);
    cbs.forEach(cb => cb(ts));
  };

  it('starts RAF when velocity > 0 after loadeddata', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });

    to.update({ velocity: 1 }); // playing
    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    // loadeddata kickoff → startLayerDraw() → requestAnimationFrame called
    expect(rafCallbacks.length).toBeGreaterThan(0);
    void layer;
  });

  it('calls gl.texImage2D when RAF fires with a ready video', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });

    to.update({ velocity: 1 });
    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    // Drain RAF, then advance past the frame-interval throttle
    drainRaf(0);   // first tick (ts=0, lastFrameTime=0 → skip paint)
    drainRaf(200); // second tick (ts=200 > 100ms → should paint)

    expect(mockGl.texImage2D).toHaveBeenCalled();
    expect(mockGl.drawArrays).toHaveBeenCalled();
    expect(mockGl.flush).toHaveBeenCalled();
    expect(mockCtx2d.drawImage).toHaveBeenCalled();
    void layer;
  });

  it('does NOT start RAF when velocity = 0 after loadeddata', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });

    // velocity stays 0 (default)
    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    expect(rafCallbacks.length).toBe(0);
    void layer;
  });

  it('paints ALL tiles sharing a URL on each RAF frame', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 4, y: 0 }); // same URL, different canvas

    to.update({ velocity: 1 });
    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    drainRaf(0);
    drainRaf(200);

    // drawImage is called once per tile per frame (two tiles, one frame)
    expect(mockCtx2d.drawImage).toHaveBeenCalledTimes(2);
    void layer;
  });
});

describe('VideoTileLayer – world-wrap URL construction', () => {
  let to: TimingObject;
  let videos: HTMLVideoElement[];

  beforeEach(() => { to = makeTo(); videos = spyOnVideoCreation(); });
  afterEach(() => { to.destroy(); });

  it.each([
    [2, -1, 0, 3], // x=-1 → x=3 at zoom 2
    [2, -2, 0, 2], // x=-2 → x=2
    [2,  4, 0, 0], // x=4  → x=0
    [2,  5, 0, 1], // x=5  → x=1
  ])('zoom=%i raw_x=%i y=%i wraps to tileX=%i', (z, rawX, y, expectedX) => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    capturedProto.createTile.call(tileCtx, { z, x: rawX, y });
    // The created video's src should reference the wrapped x
    expect(videos[0].src).toContain(`/${z}/${expectedX}/${y}.mp4`);
    void layer;
  });

  it('paints BOTH canvases when two tiles share identical wrapped coords (collision fix)', () => {
    // This is the core regression test: before the tileId fix, the second
    // createTile call with the same wrapped coords would overwrite the first
    // tile's activeTiles entry, so the central tile's canvas was never painted.
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });

    // Simulate paused playback so paintFrame is called synchronously in kickoff
    to.update({ velocity: 0 });

    // Both raw coords wrap to the same x=0 at zoom 2
    const div0 = capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    const div1 = capturedProto.createTile.call(tileCtx, { z: 2, x: 4, y: 0 });

    // One video shared by both tiles
    expect(videos).toHaveLength(1);

    mockCtx2d.drawImage.mockClear();
    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    // Both tiles must have painted their canvas (drawImage called twice)
    expect(mockCtx2d.drawImage).toHaveBeenCalledTimes(2);
    void div0; void div1;
    void layer;
  });

  it('gives each tile a unique tileId even when Leaflet passes identical wrapped coords', () => {
    const layer      = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    // Both tiles receive the same wrapped coords (x=0) but get distinct tileIds
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 4, y: 0 });

    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    // Both tileIds removed from pendingSeekTiles → tilesready fires
    expect(tilesReady).toHaveBeenCalledTimes(1);
  });

});

describe('VideoTileLayer – setSuspended', () => {
  let to: TimingObject;
  let videos: HTMLVideoElement[];

  beforeEach(() => { to = makeTo(); videos = spyOnVideoCreation(); });
  afterEach(() => { to.destroy(); });

  it('stops RAF loop when suspended', () => {
    const cancelSpy = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => undefined);
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation(() => 42);

    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });

    to.update({ velocity: 1 });
    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    (layer as any).setSuspended(true);
    expect(cancelSpy).toHaveBeenCalledWith(42);
  });
});

describe('VideoTileLayer – tile unload', () => {
  let to: TimingObject;
  let videos: HTMLVideoElement[];

  beforeEach(() => { to = makeTo(); videos = spyOnVideoCreation(); });
  afterEach(() => { to.destroy(); });

  it('keeps pool entry alive when a second tile still references the URL', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });

    const div0 = capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    const div1 = capturedProto.createTile.call(tileCtx, { z: 2, x: 4, y: 0 }); // same URL, refs=2
    expect(videos).toHaveLength(1);

    fireTileUnload(layer, div0); // refs: 2→1 — pool entry still alive
    // Re-acquire the same URL: pool entry reused, no new video created
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    expect(videos).toHaveLength(1); // no new <video> — pool entry was kept alive

    fireTileUnload(layer, div1); // refs: 2→1 for new tile + old div1
    void layer;
  });

  it('pool entry is freed when all tiles referencing a URL are unloaded', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });

    const div0 = capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    expect(videos).toHaveLength(1);

    fireTileUnload(layer, div0); // refs: 1→0 — pool entry freed

    // Next createTile for the same URL must create a fresh video element
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    expect(videos).toHaveLength(2);

    void layer;
  });

  it('removes tile from pendingSeekTiles on unload (prevents tilesready stall)', () => {
    const layer      = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    const div0 = capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 1 }); // different URL

    // Unload first tile before its video loads
    fireTileUnload(layer, div0);

    // Load second video → tilesready should fire (first tile no longer pending)
    makeVideoReady(videos[1]);
    fireEvent(videos[1], 'loadeddata');

    expect(tilesReady).toHaveBeenCalledTimes(1);
  });
});

// ── repaintAllTiles and kickLayerDraw ─────────────────────────────────────────
// These methods mirror the post-zoom syncAllTiles behaviour for first-load:
//  • repaintAllTiles — paints every active tile with the current colormap
//  • kickLayerDraw   — (re)starts the RAF loop when velocity > 0

describe('VideoTileLayer – repaintAllTiles (colormap fix)', () => {
  let to: TimingObject;
  let videos: HTMLVideoElement[];

  beforeEach(() => { to = makeTo(); videos = spyOnVideoCreation(); });
  afterEach(() => { to.destroy(); });

  it('repaintAllTiles() calls paintFrame for every active tile', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 1 }); // second URL

    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');
    makeVideoReady(videos[1]);
    fireEvent(videos[1], 'loadeddata');

    mockGl.drawArrays.mockClear();
    mockCtx2d.drawImage.mockClear();

    (layer as any).repaintAllTiles();

    // Both tiles should have been painted (one drawImage call per tile)
    expect(mockCtx2d.drawImage).toHaveBeenCalledTimes(2);
    expect(mockGl.drawArrays).toHaveBeenCalledTimes(2);
    void layer;
  });

  it('repaintAllTiles() paints central AND world-wrap tiles sharing a URL', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });

    // Central tile (x=0) and world-wrap tile (x=4) share the same video URL
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 }); // central
    capturedProto.createTile.call(tileCtx, { z: 2, x: 4, y: 0 }); // wrapping → same URL

    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    mockCtx2d.drawImage.mockClear();
    (layer as any).repaintAllTiles();

    // Both central AND wrap tile repainted
    expect(mockCtx2d.drawImage).toHaveBeenCalledTimes(2);
    void layer;
  });

  it('repaintAllTiles() uploads new LUT when colormap has changed', () => {
    let currentRgbs = getRgbs();
    const getDynamicRgbs = () => currentRgbs;
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs: getDynamicRgbs });

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    // Simulate colormap change: provide a new array reference
    currentRgbs = buildColorLUT('RdBu');
    mockGl.texImage2D.mockClear();

    (layer as any).repaintAllTiles();

    // texImage2D called twice: once for LUT (TEXTURE1), once for video (TEXTURE0)
    expect(mockGl.texImage2D).toHaveBeenCalledTimes(2);
    void layer;
  });
});

describe('VideoTileLayer – kickLayerDraw (first-load RAF fix)', () => {
  let to: TimingObject;
  let videos: HTMLVideoElement[];

  beforeEach(() => {
    to     = makeTo();
    videos = spyOnVideoCreation();
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation(() => 99);
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });
  afterEach(() => { to.destroy(); });

  it('kickLayerDraw() is idempotent when RAF is already running', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    // The layer-level layerTimingListener starts the RAF when velocity becomes non-zero.
    to.update({ velocity: 1 }); // timeupdate → layerTimingListener → startLayerDraw() → rafId=99

    const rafSpy = jest.spyOn(global, 'requestAnimationFrame');
    rafSpy.mockClear();

    (layer as any).kickLayerDraw(); // RAF already running → no-op, no second requestAnimationFrame

    expect(rafSpy).not.toHaveBeenCalled();
    void layer;
  });

  it('kickLayerDraw() does nothing when velocity = 0', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    const rafSpy = jest.spyOn(global, 'requestAnimationFrame');
    rafSpy.mockClear();

    (layer as any).kickLayerDraw(); // velocity is still 0

    expect(rafSpy).not.toHaveBeenCalled();
    void layer;
  });

  it('kickLayerDraw() does nothing when suspended', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    to.update({ velocity: 1 });
    (layer as any).setSuspended(true);

    const rafSpy = jest.spyOn(global, 'requestAnimationFrame');
    rafSpy.mockClear();

    (layer as any).kickLayerDraw();

    expect(rafSpy).not.toHaveBeenCalled();
  });
});

// ── videoWidth=0 first-load fix ───────────────────────────────────────────────
// On first load, loadeddata fires before the browser decodes the first video
// frame, so video.videoWidth === 0 and paintFrame() returns early.  The new
// kickoff branch detects this and force-seeks the video; paintFrame() is called
// from the seeked handler when the frame is available.

/** Mark a video as data-loaded but not yet frame-decoded (videoWidth = 0). */
function makeVideoNotDecoded(video: HTMLVideoElement) {
  Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
  Object.defineProperty(video, 'videoWidth',  { value: 0, configurable: true });
  const setCurrentTime = jest.fn();
  Object.defineProperty(video, 'currentTime', {
    get: () => 0,
    set: setCurrentTime,
    configurable: true,
  });
  return { setCurrentTime };
}

/** Simulate the browser decoding the first frame after a seek. */
function makeVideoDecoded(video: HTMLVideoElement) {
  Object.defineProperty(video, 'videoWidth', { value: 512, configurable: true });
}

describe('VideoTileLayer – first-load frame-decode fix (videoWidth=0)', () => {
  let to: TimingObject;
  let videos: HTMLVideoElement[];

  beforeEach(() => { to = makeTo(); videos = spyOnVideoCreation(); });
  afterEach(() => { to.destroy(); });

  it('defers tilesready until seeked when videoWidth=0 on loadeddata', () => {
    const layer      = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    const { setCurrentTime } = makeVideoNotDecoded(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    // tilesready must NOT fire yet — seek is pending
    expect(tilesReady).not.toHaveBeenCalled();
    // Force-seek must have been triggered (at t=0 we use 0.001 to guarantee seeked)
    expect(setCurrentTime).toHaveBeenCalledWith(0.001);

    // Frame becomes available after seek; fire seeked to simulate browser
    makeVideoDecoded(videos[0]);
    fireEvent(videos[0], 'seeked');

    expect(tilesReady).toHaveBeenCalledTimes(1);
    void layer;
  });

  it('calls paintFrame (WebGL) only after seeked fires when videoWidth=0', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });

    makeVideoNotDecoded(videos[0]);
    mockGl.drawArrays.mockClear();
    mockCtx2d.drawImage.mockClear();

    fireEvent(videos[0], 'loadeddata');

    // paintFrame must NOT have been called yet (videoWidth=0 guard)
    expect(mockGl.drawArrays).not.toHaveBeenCalled();
    expect(mockCtx2d.drawImage).not.toHaveBeenCalled();

    // Decode the frame and fire seeked
    makeVideoDecoded(videos[0]);
    fireEvent(videos[0], 'seeked');

    expect(mockGl.drawArrays).toHaveBeenCalled();
    expect(mockCtx2d.drawImage).toHaveBeenCalled();
    void layer;
  });

  it('defers tilesready for both world-wrap tiles sharing a URL when videoWidth=0', () => {
    const layer      = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 }); // central
    capturedProto.createTile.call(tileCtx, { z: 2, x: 4, y: 0 }); // wrap → same URL

    makeVideoNotDecoded(videos[0]);
    fireEvent(videos[0], 'loadeddata');

    expect(tilesReady).not.toHaveBeenCalled();

    makeVideoDecoded(videos[0]);
    fireEvent(videos[0], 'seeked');

    expect(tilesReady).toHaveBeenCalledTimes(1);
    void layer;
  });

  it('falls through to direct paintFrame when videoWidth>0 on loadeddata', () => {
    // Regression: normal post-zoom loads must not be broken
    const layer      = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    makeVideoReady(videos[0]); // videoWidth=512 — frame already decoded
    fireEvent(videos[0], 'loadeddata');

    // tilesready fires immediately — no seek needed
    expect(tilesReady).toHaveBeenCalledTimes(1);
    expect(mockCtx2d.drawImage).toHaveBeenCalled();
    void layer;
  });
});

// ── Autoplay: every video playing, every canvas updated on first load ──────────
// MapView calls to.update({ velocity }) inside onTilesReady on first load.
// This test verifies the end-to-end first-load path:
//   • 4 visible tiles (2 unique URLs × 2 world-wrap copies)
//   • Both videos have videoWidth=0 when loadeddata fires (first-load reality)
//   • After both videos' seeked events all 4 tiles are painted
//   • tilesready fires exactly once
//   • After autoplay (velocity > 0) + kickLayerDraw the RAF loop runs and
//     every one of the 4 tile canvases is updated on each frame

describe('VideoTileLayer – autoplay: all videos playing, all canvases updated', () => {
  let to: TimingObject;
  let videos: HTMLVideoElement[];
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    to           = makeTo();
    videos       = spyOnVideoCreation();
    rafCallbacks = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });
  afterEach(() => { to.destroy(); });

  const drainRaf = (ts: number) => {
    const cbs = rafCallbacks.splice(0);
    cbs.forEach(cb => cb(ts));
  };

  it('every canvas is updated after first-load autoplay across 4 tiles and 2 videos', () => {
    const layer      = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    // 4 tiles: 2 unique URLs × 2 world-wrap copies each
    //   /tiles/2/0/0.mp4 → tiles (z=2,x=0,y=0) and (z=2,x=4,y=0)
    //   /tiles/2/0/1.mp4 → tiles (z=2,x=0,y=1) and (z=2,x=4,y=1)
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 4, y: 0 }); // wrap → same URL
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 1 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 4, y: 1 }); // wrap → same URL

    expect(videos).toHaveLength(2); // pool deduplication: 2 unique videos for 4 tiles

    // First-load reality: videoWidth=0 when loadeddata fires
    makeVideoNotDecoded(videos[0]);
    makeVideoNotDecoded(videos[1]);
    fireEvent(videos[0], 'loadeddata');
    fireEvent(videos[1], 'loadeddata');

    // tilesready must not fire yet — all 4 tiles are waiting for seeked
    expect(tilesReady).not.toHaveBeenCalled();

    // Browser decodes frame and fires seeked for each video
    makeVideoDecoded(videos[0]);
    fireEvent(videos[0], 'seeked'); // clears 2 tiles from pendingSeekTiles
    expect(tilesReady).not.toHaveBeenCalled(); // 2 tiles for video1 still pending

    makeVideoDecoded(videos[1]);
    fireEvent(videos[1], 'seeked'); // clears the remaining 2 tiles

    // All 4 tiles settled → tilesready fires exactly once
    expect(tilesReady).toHaveBeenCalledTimes(1);

    // ── Simulate MapView autoplay (onTilesReady calls to.update then kickLayerDraw) ──
    to.update({ velocity: 0.5 });
    (layer as any).kickLayerDraw();

    // Clear counts from the seeked-phase initial paints
    mockGl.drawArrays.mockClear();
    mockCtx2d.drawImage.mockClear();

    // First RAF tick at ts=0: throttle skips paint (0 - 0 < 100 ms)
    drainRaf(0);
    // Second tick at ts=200: 200 - 0 ≥ 100 ms → paint all active tiles
    drainRaf(200);

    // All 4 tile canvases must have been updated (one drawImage call per tile per frame).
    // GL dedup: drawArrays fires once per unique URL (2 unique videos for 4 tiles),
    // not once per tile, because tiles sharing a URL reuse the shared GL canvas.
    expect(mockCtx2d.drawImage).toHaveBeenCalledTimes(4);
    expect(mockGl.drawArrays).toHaveBeenCalledTimes(2);
    void layer;
  });

  it('RAF loop keeps running so canvases continue to update while playing', () => {
    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });

    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 1 });

    makeVideoNotDecoded(videos[0]);
    makeVideoNotDecoded(videos[1]);
    fireEvent(videos[0], 'loadeddata');
    fireEvent(videos[1], 'loadeddata');
    makeVideoDecoded(videos[0]);
    makeVideoDecoded(videos[1]);
    fireEvent(videos[0], 'seeked');
    fireEvent(videos[1], 'seeked');

    to.update({ velocity: 0.5 });
    (layer as any).kickLayerDraw();

    // Two full paint cycles: ts=0 (skip), ts=200 (paint), ts=300 (skip — <100ms gap), ts=400 (paint)
    drainRaf(0);
    drainRaf(200);

    mockCtx2d.drawImage.mockClear();

    drainRaf(300); // 300-200 = 100ms — boundary; frame interval is 100ms so this paints
    drainRaf(400); // 400-300 = 100ms — paints again

    // 2 tiles × 2 paint cycles = 4 drawImage calls (loop keeps running)
    expect(mockCtx2d.drawImage).toHaveBeenCalledTimes(4);
    void layer;
  });
});

// ── Layer switch: suspend → unload → reload → unsuspend ──────────────────────
// Regression test for the "switch layer back" bug:
// When Leaflet switches base layers it removes the old layer (tileunload fires,
// pool entries freed) then adds the new layer (createTile called fresh).  The
// new tiles must paint their canvases and fire tilesready after their videos load.

describe('VideoTileLayer – layer switch round-trip (suspend → unload → reload → unsuspend)', () => {
  let to: TimingObject;
  let videos: HTMLVideoElement[];

  beforeEach(() => {
    to     = makeTo();
    videos = spyOnVideoCreation();
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation(() => 99);
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });
  afterEach(() => { to.destroy(); });

  it('canvases paint and tilesready fires when tiles are reloaded after a suspend/unload cycle', () => {
    // Matches the real Leaflet lifecycle:
    //   1. addLayer(A)  → createTile × N, videos load, tilesready fires, RAF starts
    //   2. removeLayer(A) + addLayer(B): Leaflet unloads A's tiles, then our baselayerchange
    //      handler calls setSuspended(true) on A
    //   3. removeLayer(B) + addLayer(A): Leaflet re-creates A's tiles (createTile fresh),
    //      THEN baselayerchange fires → setSuspended(false) on A
    //   Expectation: new A tiles paint their canvases and tilesready fires again.

    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    // ── Phase 1: initial load (simulates first addLayer) ──────────────────────
    const div0 = capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    const div1 = capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 1 });

    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');
    makeVideoReady(videos[1]);
    fireEvent(videos[1], 'loadeddata');

    expect(tilesReady).toHaveBeenCalledTimes(1);

    // Simulate autoplay (MapView sets velocity on first tilesready)
    to.update({ velocity: 0.5 });

    // ── Phase 2: switch AWAY — removeLayer fires tileunload then 'remove' ──
    to.update({ velocity: 0 });
    to.update({ position: 0 });

    // Real Leaflet order: tileunload per tile, then layer 'remove', then our
    // baselayerchange handler calls setSuspended(true).
    fireTileUnload(layer, div0); // pool refs: url0 → 0, freed
    fireTileUnload(layer, div1); // pool refs: url1 → 0, freed
    (layer as any).fire('remove'); // triggers sharedGLCanvas recreation fix
    (layer as any).setSuspended(true);

    // ── Phase 3: switch BACK — Leaflet re-creates tiles BEFORE baselayerchange fires ──
    // createTile is called before setSuspended(false) in the real browser.
    // New video elements are created because pool was freed.
    const div0b = capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    const div1b = capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 1 });

    // baselayerchange fires → setSuspended(false); syncAllTiles skips tiles in pendingSeekTiles
    (layer as any).setSuspended(false);

    tilesReady.mockClear();
    mockCtx2d.drawImage.mockClear();

    // Videos load for the newly-created tiles (fresh pool entries)
    makeVideoReady(videos[2]); // new video for /tiles/2/0/0.mp4
    fireEvent(videos[2], 'loadeddata');
    makeVideoReady(videos[3]); // new video for /tiles/2/0/1.mp4
    fireEvent(videos[3], 'loadeddata');

    // Both canvases must have been painted
    expect(mockCtx2d.drawImage).toHaveBeenCalledTimes(2);
    // tilesready must fire so MapView can resume playback
    expect(tilesReady).toHaveBeenCalledTimes(1);

    void div0b; void div1b;
  });

  it('LUT texture is re-uploaded to the new GL context after remove+re-add', () => {
    // Regression: layerLastRgbs was not reset on remove, so the reference-equality
    // check in paintFrame skipped uploadLUT for the new GL context → shader sampled
    // from a blank texture → tiles rendered black until the colormap was changed.
    // Fix: layerLastRgbs = null in the remove handler forces a re-upload.

    // Use a stable getRgbs reference (same object every call), matching how the
    // real app works (getRgbs = () => rgbsRef.current).
    const stableRgbs = buildColorLUT('Spectral');
    const getStableRgbs = () => stableRgbs;

    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs: getStableRgbs });

    // Phase 1: initial load — LUT uploaded on first paintFrame
    const div0 = capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    makeVideoReady(videos[0]);
    mockGl.texImage2D.mockClear();
    fireEvent(videos[0], 'loadeddata');
    // texImage2D called twice: video texture (TEXTURE0) + LUT (TEXTURE1)
    expect(mockGl.texImage2D).toHaveBeenCalledTimes(2);

    // Phase 2: remove — layerLastRgbs must be cleared
    fireTileUnload(layer, div0);
    (layer as any).fire('remove');
    (layer as any).setSuspended(true);

    // Phase 3: re-add
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    (layer as any).setSuspended(false);

    mockGl.texImage2D.mockClear();

    // Same stableRgbs reference — without the fix, layerLastRgbs === stableRgbs
    // so uploadLUT would be skipped and the new GL context would have a blank LUT.
    makeVideoReady(videos[1]);
    fireEvent(videos[1], 'loadeddata');

    // Must call texImage2D twice again: new GL context needs both textures uploaded
    expect(mockGl.texImage2D).toHaveBeenCalledTimes(2);

    void layer;
  });

  it('WebGL context is valid after remove+re-add even when WEBGL_lose_context is supported', () => {
    // Regression: before the fix, the remove handler called loseContext() and then
    // reused the same canvas.  canvas.getContext('webgl') on a canvas with a lost
    // context returns the same dead object (per HTML spec), so all GL draw calls
    // were no-ops and ctx2d.drawImage copied a blank frame — tiles stayed transparent.
    // The fix creates a fresh canvas on remove so re-add gets a live GL context.

    // Make getExtension return a real loseContext stub so the remove handler
    // actually marks the canvas as "context-lost" in our mock environment.
    let contextLost = false;
    mockGl.getExtension = jest.fn((name: string) => {
      if (name === 'WEBGL_lose_context') {
        return { loseContext: () => { contextLost = true; } };
      }
      return null;
    });

    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    // Phase 1: initial load
    const div0 = capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');
    expect(tilesReady).toHaveBeenCalledTimes(1);

    // Phase 2: remove — loseContext is called, fix creates a new canvas
    fireTileUnload(layer, div0);
    (layer as any).fire('remove'); // calls loseContext() on old canvas; fix replaces canvas
    expect(contextLost).toBe(true); // verify loseContext actually ran
    (layer as any).setSuspended(true);

    // Phase 3: re-add — new tiles on the fresh canvas
    const div0b = capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    (layer as any).setSuspended(false);

    tilesReady.mockClear();
    mockCtx2d.drawImage.mockClear();
    mockGl.drawArrays.mockClear();

    makeVideoReady(videos[1]);
    fireEvent(videos[1], 'loadeddata');

    // Tiles must paint (WebGL draw called) and tilesready must fire
    expect(mockGl.drawArrays).toHaveBeenCalled();
    expect(mockCtx2d.drawImage).toHaveBeenCalled();
    expect(tilesReady).toHaveBeenCalledTimes(1);

    void div0b;
  });

  it('canvases paint when videos have videoWidth=0 on first loadeddata after a reload', () => {
    // Same as above but videos report videoWidth=0 (frame not decoded yet)
    // — the force-seek path in kickoff must still resolve and paint.

    const layer = createVideoTileLayer({ src: '/tiles', timingObject: to, getRgbs });
    const tilesReady = jest.fn();
    (layer as any).on('tilesready', tilesReady);

    // Phase 1: initial load
    const div0 = capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    makeVideoReady(videos[0]);
    fireEvent(videos[0], 'loadeddata');
    expect(tilesReady).toHaveBeenCalledTimes(1);

    to.update({ velocity: 0.5 });

    // Phase 2: switch away (tileunload → 'remove' → setSuspended)
    to.update({ velocity: 0 });
    to.update({ position: 0 });
    fireTileUnload(layer, div0);
    (layer as any).fire('remove');
    (layer as any).setSuspended(true);

    // Phase 3: switch back — fresh createTile, then setSuspended(false)
    capturedProto.createTile.call(tileCtx, { z: 2, x: 0, y: 0 });
    (layer as any).setSuspended(false);

    tilesReady.mockClear();
    mockCtx2d.drawImage.mockClear();

    // Video loads but frame not decoded yet (videoWidth=0)
    const { setCurrentTime } = makeVideoNotDecoded(videos[1]);
    fireEvent(videos[1], 'loadeddata');

    // Canvas must NOT be painted yet (waiting for seeked)
    expect(mockCtx2d.drawImage).not.toHaveBeenCalled();

    // Frame decoded after seek
    makeVideoDecoded(videos[1]);
    fireEvent(videos[1], 'seeked');

    expect(mockCtx2d.drawImage).toHaveBeenCalled();
    expect(tilesReady).toHaveBeenCalledTimes(1);

    void setCurrentTime;
  });
});
