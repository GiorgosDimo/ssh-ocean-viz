import L from 'leaflet';
import type { TimingObject } from './TimingObject';
import type { RgbColor } from './colormap';

const FRAME_INTERVAL_MS     = 100;
const TRANSPARENT_THRESHOLD = 30;
const MAX_VIDEO_POOL        = 12;
// Seek threshold: if a video's currentTime is more than one 25fps frame from
// the target, snap it to the exact target time so all tiles paint the same
// frame.  mediaSync was removed in favour of this explicit seek approach
// because per-video rate-control causes inter-tile drift that shows as seam
// artifacts at tile borders.
const SEEK_THRESHOLD             = 0.04;
// If the spread between any two videos' currentTime exceeds this, all videos
// are re-seeked together so they land on the same frame.  Set to 2.5×
// SEEK_THRESHOLD so normal per-video drift (≤ 2 × SEEK_THRESHOLD spread) is
// handled by the regular per-target check without triggering a full resync.
const INTER_VIDEO_DRIFT_THRESHOLD = 0.1;
// Maps Leaflet tile zoom → SSH data zoom (which tile/{z}/... directory to use).
// Two consecutive map zoom steps share the same data zoom so the browser only
// loads new video files every other zoom level instead of every step.
//   tile 1 → data 1   (map zoom 1.0)
//   tile 2 → data 1   (map zoom 1.5 / 2.0 — parent tile, cropped 2×)
//   tile 3 → data 2   (map zoom 3.0 / 3.5 — parent tile, cropped 2×)
//   tile 4 → data 3   (map zoom 4.0 / 4.5 — parent tile, cropped 2×)
const DATA_ZOOM_FOR_TILE_Z = [0, 1, 1, 2, 3] as const;

export interface VideoTileLayerOptions extends L.GridLayerOptions {
  src:          string;
  timingObject: TimingObject;
  getRgbs:      () => RgbColor[];
  speedRatio?:  number;
}

// ── WebGL shaders ─────────────────────────────────────────────────────────────
const VERT = `
  attribute vec2 a_pos;
  varying   vec2 v_uv;
  void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
    v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  }`;

const FRAG = `
  precision mediump float;
  uniform sampler2D u_video;
  uniform sampler2D u_lut;
  uniform float     u_threshold;
  varying vec2      v_uv;
  void main() {
    float b = texture2D(u_video, v_uv).r;
    if (b < u_threshold) { gl_FragColor = vec4(0.0); return; }
    gl_FragColor = vec4(
      texture2D(u_lut, vec2((b * 255.0 + 0.5) / 256.0, 0.5)).rgb,
      1.0
    );
  }`;

// ── Shared WebGL state (one per layer) ────────────────────────────────────────
interface LayerGL {
  gl:       WebGLRenderingContext;
  videoTex: WebGLTexture;
  lutTex:   WebGLTexture;
}

function buildLayerGL(canvas: HTMLCanvasElement): LayerGL | null {
  const gl = canvas.getContext('webgl', {
    alpha:              true,
    premultipliedAlpha: false,
  }) as WebGLRenderingContext | null;
  if (!gl) return null;

  const mkShader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, mkShader(gl.VERTEX_SHADER,   VERT));
  gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  gl.uniform1i(gl.getUniformLocation(prog, 'u_video')!,     0);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_lut')!,       1);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_threshold')!, TRANSPARENT_THRESHOLD / 255);

  const mkTex = (unit: number): WebGLTexture => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE);
    return t;
  };
  return { gl, videoTex: mkTex(0), lutTex: mkTex(1) };
}

function uploadLUT(lgl: LayerGL, rgbs: RgbColor[]) {
  const { gl, lutTex } = lgl;
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const c = rgbs[i];
    data[i * 4]     = c.r;
    data[i * 4 + 1] = c.g;
    data[i * 4 + 2] = c.b;
    data[i * 4 + 3] = 255;
  }
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

// ── Layer factory ─────────────────────────────────────────────────────────────
export function createVideoTileLayer(options: VideoTileLayerOptions): L.GridLayer {
  const { src, timingObject, speedRatio = 1 } = options;

  // Feature-detect once: requestVideoFrameCallback fires at compositor time
  // when a new decoded frame is ready (after load or after a seek on a paused
  // video).  When available it replaces the unconditional RAF paintFrame calls,
  // so tiles are only drawn when the browser actually has new pixel data.
  const supportsRVFC =
    typeof HTMLVideoElement !== 'undefined' &&
    'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  // ── Video pool: one <video> per unique URL ────────────────────────────────
  //
  // Videos are kept PAUSED; the RAF loop seeks them to the current target time
  // on every 100 ms tick.  This replaces mediaSync rate-control, which caused
  // inter-tile drift and seam artifacts.
  //
  // pendingKickoffs: callbacks waiting for this video's first loadeddata.
  interface PoolEntry {
    video:           HTMLVideoElement;
    refs:            number;
    isReady:         boolean;
    destroyed:       boolean;  // set by releaseVideo when refs hit 0
    pendingKickoffs: (() => void)[];
    // Stored so releaseVideo can remove them before freeing the media element.
    onLoadedData:    () => void;
    onError:         () => void;
  }
  const videoPool = new Map<string, PoolEntry>();

  // ── Per-tile state ────────────────────────────────────────────────────────
  // Leaflet wraps tile coordinates (via _wrapCoords) before calling createTile,
  // so two tiles at different world-repetitions receive identical coords (e.g.
  // raw x=4 and x=0 both arrive as x=0 at zoom 2).  Using a coord-based key
  // would cause their activeTiles entries to collide, silently discarding the
  // central tile's paintFrame.  A monotone counter avoids that entirely.
  let   tileSeq = 0;
  interface TileState { paintFrame: () => void; srcX: number; srcY: number; srcW: number; srcH: number; }
  const activeTiles       = new Map<string, TileState>();
  // canvas element → tileId; used by samplePixel to find the right video.
  const canvasToTileId    = new Map<HTMLCanvasElement, string>();
  const tileIdToCanvas    = new Map<string, HTMLCanvasElement>();
  // Shared off-screen canvas for reading raw video brightness (no colormap).
  let   sampleCanvas: HTMLCanvasElement | null = null;
  let   sampleCtx:    CanvasRenderingContext2D | null = null;
  const pendingSeekTiles = new Set<string>();
  // Tracks when each URL's seek was last issued (ms). Used to override the
  // video.seeking guard when a seek stalls — if a seek takes >SEEK_STALE_MS the
  // browser is waiting on the network; re-issuing to the current target unsticks it.
  const seekIssuedAt  = new Map<string, number>();
  const SEEK_STALE_MS = 400;
  // Batch all rVFC/seeked-triggered paints into one rAF so every tile composites
  // in the same browser frame instead of trickling in over several ms.
  const pendingRafPaints = new Set<string>();
  let   paintBatchRafId: number | null = null;
  const schedulePaintFrame = (tileId: string) => {
    pendingRafPaints.add(tileId);
    if (paintBatchRafId === null) {
      paintBatchRafId = requestAnimationFrame(() => {
        paintBatchRafId = null;
        pendingRafPaints.forEach(id => activeTiles.get(id)?.paintFrame());
        pendingRafPaints.clear();
      });
    }
  };
  let   anyTileStartedLoading = false;

  // Persistent seeked listeners (repaint when paused); cleaned on tileunload.
  const paintListeners = new Map<string, { video: HTMLVideoElement; fn: () => void; errFn: () => void }>();

  // Map the tile's root element → tileId so tileunload (which provides the
  // DOM element, not the wrapped coords) can find the right entry to clean up.
  const divToTileId = new Map<HTMLElement, string>();

  // tileId → video URL so tileunload can decrement the right pool entry.
  const tileIdToUrl = new Map<string, string>();

  // ── Shared WebGL renderer (one GL context for the whole layer) ────────────
  // Must be `let` so the remove handler can replace it with a fresh element;
  // explicitly losing a WebGL context (via WEBGL_lose_context) makes the canvas
  // permanently return the same dead context on subsequent getContext() calls,
  // so re-adding the layer would get a no-op GL context and paint nothing.
  let sharedGLCanvas = document.createElement('canvas');
  let   sharedLGL:     LayerGL | null = null;
  let   layerLastRgbs: RgbColor[] | null = null;
  let   glInitialised  = false;
  // Tracks what is currently rendered into sharedGLCanvas so paintFrame can
  // skip the expensive texImage2D + drawArrays when the GL canvas already
  // holds the correct frame.  ctx2d.drawImage (a cheap GPU blit from the
  // shared canvas to the tile canvas) is always called so the tile canvas
  // stays up-to-date even when the GL upload is skipped.
  let   glCanvasUrl:  string | null = null;
  let   glCanvasTime: number        = -1;
  // Incremented whenever the LUT (colormap) changes; forces a GL re-draw
  // even when video.currentTime hasn't advanced.
  let   lutVersion    = 0;
  let   glCanvasLut:  number        = -1;

  // ── Draw / seek loop ──────────────────────────────────────────────────────
  // When rVFC is available painting is handled by per-video rVFC callbacks, so
  // the loop only needs to run drift-correction seeks.  A setTimeout at the
  // target interval (10 Hz) is then cheaper than a 60 Hz RAF that skips most
  // frames.  On browsers without rVFC the RAF path is kept so painting stays
  // display-sync'd.
  let layerRafId:   number | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let layerTimerId: any    | null = null; // ReturnType<typeof setTimeout>
  let lastLayerFrameTime = 0;
  let suspended          = false;

  // Seek any video whose currentTime has drifted past SEEK_THRESHOLD from the
  // target.  Called by both the RAF loop and the setTimeout tick.
  const seekDriftedVideos = () => {
    if (document.hidden) return;
    const { position } = timingObject.query();
    const targetTime   = position * speedRatio;

    // Measure inter-video spread: if any two videos differ by more than
    // INTER_VIDEO_DRIFT_THRESHOLD, one has fallen behind the group.
    const urlToTime = new Map<string, number>();
    activeTiles.forEach((_, tileId) => {
      if (pendingSeekTiles.has(tileId)) return;
      const url   = tileIdToUrl.get(tileId);
      const entry = url ? videoPool.get(url) : undefined;
      if (!entry?.isReady || urlToTime.has(url!)) return;
      urlToTime.set(url!, entry.video.currentTime);
    });
    let hardResync = false;
    if (urlToTime.size >= 2) {
      const times  = Array.from(urlToTime.values());
      const spread = Math.max(...times) - Math.min(...times);
      if (spread > INTER_VIDEO_DRIFT_THRESHOLD) hardResync = true;
    }

    const urlsSought = new Set<string>();
    activeTiles.forEach((_, tileId) => {
      if (pendingSeekTiles.has(tileId)) return;
      const url   = tileIdToUrl.get(tileId);
      const entry = url ? videoPool.get(url) : undefined;
      if (!entry?.isReady || urlsSought.has(url!)) return;
      // Skip if mid-seek, unless the seek has been pending too long (stalled network).
      // ?? Infinity: if we never issued this seek (e.g. kickoff did), always skip.
      if (entry.video.seeking && Date.now() - (seekIssuedAt.get(url!) ?? Infinity) < SEEK_STALE_MS) return;
      const { video } = entry;
      if (hardResync || Math.abs(video.currentTime - targetTime) > SEEK_THRESHOLD) {
        urlsSought.add(url!);
        seekIssuedAt.set(url!, Date.now());
        video.currentTime = targetTime;
      }
    });
  };

  const startLayerDraw = () => {
    if (layerRafId !== null || layerTimerId !== null || suspended) return;

    if (supportsRVFC) {
      // rVFC handles painting; only need a 10 Hz timer for drift correction.
      const tick = () => {
        const { velocity } = timingObject.query();
        if (velocity === 0 || suspended) { layerTimerId = null; return; }
        seekDriftedVideos();
        layerTimerId = setTimeout(tick, FRAME_INTERVAL_MS);
      };
      layerTimerId = setTimeout(tick, FRAME_INTERVAL_MS);
    } else {
      // No rVFC: 60 Hz RAF drives both drift correction and painting.
      const loop = (ts: number) => {
        const { velocity } = timingObject.query();
        if (velocity === 0 || suspended) { layerRafId = null; return; }
        layerRafId = requestAnimationFrame(loop);
        if (ts - lastLayerFrameTime < FRAME_INTERVAL_MS) return;
        lastLayerFrameTime = ts;
        seekDriftedVideos();
        activeTiles.forEach(({ paintFrame }) => paintFrame());
      };
      layerRafId = requestAnimationFrame(loop);
    }
  };

  const stopLayerDraw = () => {
    if (layerRafId   !== null) { cancelAnimationFrame(layerRafId);  layerRafId   = null; }
    if (layerTimerId !== null) { clearTimeout(layerTimerId); layerTimerId = null; }
  };

  // ── tilesready gate ───────────────────────────────────────────────────────
  const checkAllReady = () => {
    if (!anyTileStartedLoading)      return;
    if (pendingSeekTiles.size !== 0) return;
    anyTileStartedLoading = false;
    (layer as L.Evented).fire('tilesready');
  };

  // ── Get or create a pooled video ──────────────────────────────────────────
  const acquireVideo = (url: string): PoolEntry => {
    let entry = videoPool.get(url);
    if (!entry && videoPool.size >= MAX_VIDEO_POOL) {
      for (const [u, e] of videoPool) {
        if (e.refs === 0) { releaseVideo(u); break; }
      }
    }
    if (!entry) {
      const video = document.createElement('video');
      video.src      = url;
      video.autoplay = false;
      video.muted    = true;
      video.preload  = 'auto';
      video.controls = false;
      video.style.display = 'none';

      // Named so releaseVideo can remove them before clearing the src.
      const onLoadedData = () => {
        if (newEntry.destroyed) return;
        newEntry.isReady = true;

        // If playing, start the RAF loop (the layer-level timingListener handles
        // the normal case; this covers videos that finish loading mid-playback).
        if (!suspended) {
          const { velocity } = timingObject.query();
          if (velocity !== 0) startLayerDraw();
        }

        const cbs = newEntry.pendingKickoffs.splice(0);
        cbs.forEach((cb) => cb());
      };

      const onError = () => {
        tileIdToUrl.forEach((vUrl, tileId) => {
          if (vUrl !== url) return;
          pendingSeekTiles.delete(tileId);
          activeTiles.delete(tileId);
        });
        newEntry.pendingKickoffs.length = 0;
        checkAllReady();
        videoPool.delete(url);
      };

      const newEntry: PoolEntry = {
        video,
        refs: 0, isReady: false, destroyed: false, pendingKickoffs: [],
        onLoadedData, onError,
      };
      entry = newEntry;
      videoPool.set(url, newEntry);

      video.addEventListener('loadeddata', onLoadedData);
      video.addEventListener('error',      onError);

      // requestVideoFrameCallback: whenever the browser has decoded a new
      // video frame (after load or after a seek on a paused video), paint
      // every tile that references this URL.  The per-tile dedup in paintFrame
      // (lastPaintedTime / lutVersion) makes redundant calls free.
      if (supportsRVFC) {
        const onNewFrame = () => {
          if (newEntry.destroyed) return; // pool entry released; stop loop
          activeTiles.forEach((_, tileId) => {
            if (tileIdToUrl.get(tileId) === url) schedulePaintFrame(tileId);
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (video as any).requestVideoFrameCallback(onNewFrame);
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (video as any).requestVideoFrameCallback(onNewFrame);
      }
    }
    entry.refs++;
    return entry;
  };

  const releaseVideo = (url: string) => {
    const entry = videoPool.get(url);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;
    entry.destroyed = true;
    entry.pendingKickoffs.length = 0;
    videoPool.delete(url);
    seekIssuedAt.delete(url);
    // Remove listeners and tell the browser to stop buffering/decoding.
    // Without this the video element keeps network connections open and
    // continues decoding frames in the background, burning CPU and RAM that
    // accumulate with every pan/zoom cycle and cause progressive slowdown.
    entry.video.removeEventListener('loadeddata', entry.onLoadedData);
    entry.video.removeEventListener('error',      entry.onError);
    entry.video.removeAttribute('src');
    entry.video.load(); // resets internal state, releases buffer pool
  };

  // ── Layer definition ──────────────────────────────────────────────────────
  const VideoTileLayerDef = L.GridLayer.extend({
    initialize() {
      L.Util.setOptions(this, {
        tileSize:    512,
        noWrap:      false,
        interactive: true,
        keepBuffer:  0,
      });
    },

    // Use Math.floor instead of Leaflet's default Math.round so half-step map
    // zooms (1.5, 2.5, 3.5, 4.5) stay at the lower integer tile zoom and are
    // handled by CSS upscaling rather than loading a new set of tile videos.
    _clampZoom(zoom: number) {
      const map = (this as any)._map as L.Map | undefined;
      const floored = map ? Math.floor(map.getZoom()) : Math.floor(zoom);
      return (L.GridLayer.prototype as any)._clampZoom.call(this, floored);
    },

    onAdd(map: L.Map) {
      L.GridLayer.prototype.onAdd.call(this, map);
      L.DomUtil.addClass(this._container as HTMLElement, 'leaflet-interactive');
    },

    createTile(coords: L.Coords): HTMLElement {
      // Leaflet wraps coords before calling createTile, so two tiles at
      // different world-repetitions can receive identical (x,y,z).  Use a
      // monotone counter as the per-instance key to avoid Map collisions.
      const tileId  = `t${tileSeq++}`;
      const size    = this.getTileSize() as L.Point;
      const numCols = 1 << coords.z;
      const tileX   = ((coords.x % numCols) + numCols) % numCols;
      // Look up the SSH data zoom for this Leaflet tile zoom.  Two Leaflet tile
      // zoom steps map to the same data zoom so video files are reused across
      // half-step map zooms; only the CSS scale and sub-region change.
      const dataZ    = DATA_ZOOM_FOR_TILE_Z[Math.min(coords.z, DATA_ZOOM_FOR_TILE_Z.length - 1)];
      const zDiff    = coords.z - dataZ;
      const dScale   = 1 << zDiff;
      const eX       = tileX >> zDiff;
      const eY       = coords.y >> zDiff;
      const videoUrl = `${src}/${dataZ}/${eX}/${eY}.mp4`;
      // Sub-region of the data tile video to display in this canvas.
      // When dataZ === coords.z (zDiff=0), this is a full-tile blit with no crop.
      const tileSrcW = size.x / dScale;
      const tileSrcH = size.y / dScale;
      const tileSrcX = (tileX & (dScale - 1)) * tileSrcW;
      const tileSrcY = (coords.y & (dScale - 1)) * tileSrcH;

      const div  = L.DomUtil.create('div', 'leaflet-tile') as HTMLDivElement;
      divToTileId.set(div, tileId);

      const canvas = document.createElement('canvas');
      canvas.width  = size.x;
      canvas.height = size.y;
      canvas.classList.add('color');
      L.DomUtil.addClass(canvas, 'leaflet-interactive');
      const ctx2d = canvas.getContext('2d');
      div.appendChild(canvas);
      canvas.style.visibility = 'hidden'; // revealed after first seek to correct frame
      (this as L.GridLayer).addInteractiveTarget(canvas);

      // Lazy WebGL init (once per layer, on the first tile).
      if (!glInitialised) {
        glInitialised = true;
        sharedGLCanvas.width  = size.x;
        sharedGLCanvas.height = size.y;
        sharedLGL = buildLayerGL(sharedGLCanvas);
      }

      // Lazy sample-canvas init: used by samplePixel to read raw brightness.
      if (!sampleCanvas) {
        sampleCanvas = document.createElement('canvas');
        sampleCanvas.width  = size.x;
        sampleCanvas.height = size.y;
        sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      }

      // Track this canvas so samplePixel can look up the corresponding video.
      canvasToTileId.set(canvas, tileId);
      tileIdToCanvas.set(tileId, canvas);

      // 2D-only fallback (when WebGL is unavailable).
      let ctx1: CanvasRenderingContext2D | null = null;
      if (!sharedLGL) {
        const canvas1 = document.createElement('canvas');
        canvas1.width = size.x; canvas1.height = size.y;
        canvas1.style.display = 'none';
        div.insertBefore(canvas1, canvas);
        ctx1 = canvas1.getContext('2d', { willReadFrequently: true });
      }

      const entry = acquireVideo(videoUrl);
      const { video } = entry;
      tileIdToUrl.set(tileId, videoUrl);

      // ── Paint ─────────────────────────────────────────────────────────────
      const paintFrame = () => {
        if (video.readyState < 2 || video.videoWidth === 0) return;

        if (sharedLGL && ctx2d) {
          const { gl, videoTex } = sharedLGL;
          const rgbs = options.getRgbs();
          if (rgbs !== layerLastRgbs) {
            layerLastRgbs = rgbs;
            uploadLUT(sharedLGL, rgbs);
            lutVersion++;
            glCanvasLut = -1; // force GL re-draw so new LUT takes effect
          }

          // Skip texImage2D + drawArrays if the shared GL canvas already holds
          // this video URL at the current time and LUT.  This avoids re-uploading
          // 512×512 pixels to the GPU when the frame hasn't changed.
          // ctx2d.drawImage (a cheap GPU blit) is always called so the tile
          // canvas stays current even when the GL draw is skipped.
          const ct = video.currentTime;
          if (glCanvasUrl !== videoUrl || glCanvasTime !== ct || glCanvasLut !== lutVersion) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, videoTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.flush();
            glCanvasUrl  = videoUrl;
            glCanvasTime = ct;
            glCanvasLut  = lutVersion;
          }
          ctx2d.globalCompositeOperation = 'copy';
          ctx2d.drawImage(sharedGLCanvas, tileSrcX, tileSrcY, tileSrcW, tileSrcH, 0, 0, canvas.width, canvas.height);
          ctx2d.globalCompositeOperation = 'source-over';
        } else if (ctx1 && ctx2d) {
          ctx1.drawImage(video, tileSrcX, tileSrcY, tileSrcW, tileSrcH, 0, 0, canvas.width, canvas.height);
          const imageData = ctx1.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          const rgbs = options.getRgbs();
          for (let i = 0; i < data.length; i += 4) {
            const val = data[i];
            if (val < TRANSPARENT_THRESHOLD) { data[i + 3] = 0; continue; }
            const c = rgbs[val];
            data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b;
          }
          ctx2d.putImageData(imageData, 0, 0);
        }
      };

      activeTiles.set(tileId, { paintFrame, srcX: tileSrcX, srcY: tileSrcY, srcW: tileSrcW, srcH: tileSrcH });
      anyTileStartedLoading = true;
      pendingSeekTiles.add(tileId);

      // Persistent: repaint this tile's canvas when a seek completes —
      // both when paused (user scrubs) and during playback (RAF-initiated
      // drift correction).  The RAF immediately calls paintFrame() after
      // seeking, which may show one stale frame; this handler repaints with
      // the correct decoded frame ~30 ms later.
      const onVideoSeeked = () => { schedulePaintFrame(tileId); };
      const onVideoError  = () => { seekDriftedVideos(); };
      video.addEventListener('seeked', onVideoSeeked);
      video.addEventListener('error', onVideoError);
      paintListeners.set(tileId, { video, fn: onVideoSeeked, errFn: onVideoError });

      // Kickoff: seek to current playback position (even when paused) before
      // showing the tile.  This fixes both the "frame 0 flash" on zoom and
      // inter-tile desync when new tiles load during playback.
      const kickoff = () => {
        const target = timingObject.query().position * speedRatio;
        const { velocity } = timingObject.query();
        if (velocity !== 0) startLayerDraw();

        if (Math.abs(video.currentTime - target) > SEEK_THRESHOLD || video.videoWidth === 0) {
          video.addEventListener('seeked', () => {
            pendingSeekTiles.delete(tileId);
            canvas.style.visibility = '';
            paintFrame();
            checkAllReady();
          }, { once: true });
          video.currentTime = target > 0 ? target : 0.001;
        } else {
          // Pool hit: video already at the right frame.
          pendingSeekTiles.delete(tileId);
          canvas.style.visibility = '';
          // When paused, paint immediately (RAF isn't running).
          // When playing, the RAF loop will paint within ~16 ms.
          if (velocity === 0) paintFrame();
          checkAllReady();
        }
      };

      if (entry.isReady) {
        // Video already loaded (another tile loaded it first) — kickoff now.
        kickoff();
      } else {
        // Enqueue: fired synchronously from the loadeddata handler.
        entry.pendingKickoffs.push(kickoff);
      }

      return div;
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = new (VideoTileLayerDef as any)() as L.GridLayer;

  // Single layer-level listener: start RAF when velocity becomes non-zero.
  // (Previously each pool entry had its own timingListener; one suffices.)
  const layerTimingListener = () => {
    if (!suspended) {
      const { velocity } = timingObject.query();
      if (velocity !== 0) startLayerDraw();
    }
  };
  timingObject.on('timeupdate', layerTimingListener);

  // ── repaintAllTiles ───────────────────────────────────────────────────────
  // Call this whenever the colormap changes and the layer may be paused —
  // the RAF loop is stopped, so tiles won't repaint without an explicit kick.
  (layer as any).repaintAllTiles = () => {
    activeTiles.forEach(({ paintFrame }) => paintFrame());
  };

  // ── kickLayerDraw ─────────────────────────────────────────────────────────
  // Call after first load / tilesready to (re)start the RAF loop if playing.
  // Mirrors what the timingListener does on every timeupdate, but can be
  // called explicitly when we know playback should be running.
  (layer as any).kickLayerDraw = () => {
    const { velocity } = timingObject.query();
    if (velocity !== 0 && !suspended) startLayerDraw();
  };

  // ── syncAllTiles ──────────────────────────────────────────────────────────
  (layer as any).syncAllTiles = () => {
    const { position } = timingObject.query();
    const targetTime   = position * speedRatio;
    anyTileStartedLoading = true;

    // Seek each unique video at most once. Tiles sharing a URL all repaint
    // via their persistent onVideoSeeked listeners when seeked fires.
    const urlsNeedingSeek = new Set<string>();

    activeTiles.forEach(({ paintFrame }, tileId) => {
      if (pendingSeekTiles.has(tileId)) return;
      const url   = tileIdToUrl.get(tileId);
      const entry = url ? videoPool.get(url) : undefined;
      if (!entry) return;
      const { video } = entry;

      if (Math.abs(video.currentTime - targetTime) > 0.1) {
        if (!urlsNeedingSeek.has(url!)) {
          urlsNeedingSeek.add(url!);
          // Only one tile per URL is tracked in pendingSeekTiles; the others
          // repaint via their persistent seeked listeners.
          pendingSeekTiles.add(tileId);
          video.addEventListener('seeked', () => {
            pendingSeekTiles.delete(tileId);
            paintFrame();
            checkAllReady();
          }, { once: true });
          video.currentTime = targetTime;
        }
      } else {
        paintFrame();
      }
    });

    checkAllReady();
  };

  // ── forceSyncAllTiles ─────────────────────────────────────────────────────
  // Like syncAllTiles but with threshold=0 — always seeks, used by scrubber.
  (layer as any).forceSyncAllTiles = () => {
    const { position } = timingObject.query();
    const targetTime   = position * speedRatio;
    anyTileStartedLoading = true;
    const urlsSought = new Set<string>();
    activeTiles.forEach(({ paintFrame }, tileId) => {
      if (pendingSeekTiles.has(tileId)) return;
      const url   = tileIdToUrl.get(tileId);
      const entry = url ? videoPool.get(url) : undefined;
      if (!entry) return;
      const { video } = entry;
      if (!urlsSought.has(url!)) {
        urlsSought.add(url!);
        pendingSeekTiles.add(tileId);
        video.addEventListener('seeked', () => {
          pendingSeekTiles.delete(tileId);
          paintFrame();
          checkAllReady();
        }, { once: true });
        video.currentTime = targetTime;
      }
    });
    checkAllReady();
  };

  // ── samplePixel ───────────────────────────────────────────────────────────
  // Returns the raw video brightness (0–1) at the given pixel of a tile canvas,
  // or null if no data.  Used by the SSH readout to avoid reading back
  // colormap-distorted RGB values from the painted canvas.
  (layer as any).samplePixel = (canvas: HTMLCanvasElement, x: number, y: number): number | null => {
    const tileId = canvasToTileId.get(canvas);
    if (!tileId) return null;
    const url   = tileIdToUrl.get(tileId);
    const entry = url ? videoPool.get(url) : undefined;
    if (!entry?.isReady) return null;
    const { video } = entry;
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    if (!sampleCtx) return null;
    sampleCtx.drawImage(video, 0, 0, sampleCanvas!.width, sampleCanvas!.height);
    const px  = Math.max(0, Math.min(Math.floor(x), sampleCanvas!.width  - 1));
    const py  = Math.max(0, Math.min(Math.floor(y), sampleCanvas!.height - 1));
    // Map canvas pixel → video pixel, accounting for parent-tile crop.
    const ts  = activeTiles.get(tileId);
    const vx  = ts ? Math.max(0, Math.min(Math.floor(ts.srcX + px * ts.srcW / sampleCanvas!.width),  sampleCanvas!.width  - 1)) : px;
    const vy  = ts ? Math.max(0, Math.min(Math.floor(ts.srcY + py * ts.srcH / sampleCanvas!.height), sampleCanvas!.height - 1)) : py;
    const { data } = sampleCtx.getImageData(vx, vy, 1, 1);
    const brightness = data[0] / 255; // red channel = greyscale value
    if (brightness < TRANSPARENT_THRESHOLD / 255) return null;
    return brightness;
  };

  // ── setSuspended ──────────────────────────────────────────────────────────
  // Videos are always paused (seek-driven); suspension only stops the RAF loop.
  (layer as any).setSuspended = (isSuspended: boolean) => {
    suspended = isSuspended;
    if (isSuspended) {
      stopLayerDraw();
    } else {
      const { velocity } = timingObject.query();
      if (velocity !== 0) startLayerDraw();
      (layer as any).syncAllTiles();
    }
  };

  // ── Tile unload ───────────────────────────────────────────────────────────
  // tileunload fires with the raw (unwrapped) coords and the tile DOM element.
  // We look up the tileId via the DOM element to avoid any coord-key mismatch.
  layer.on('tileunload', (e: L.LeafletEvent) => {
    const tileEl = (e as any).tile as HTMLElement;
    const tileId = divToTileId.get(tileEl);
    if (!tileId) return;
    divToTileId.delete(tileEl);

    const url = tileIdToUrl.get(tileId);

    // Remove persistent seeked listener.
    const pl = paintListeners.get(tileId);
    if (pl) {
      pl.video.removeEventListener('seeked', pl.fn);
      pl.video.removeEventListener('error', pl.errFn);
      paintListeners.delete(tileId);
    }

    activeTiles.delete(tileId);
    pendingSeekTiles.delete(tileId);
    pendingRafPaints.delete(tileId);
    tileIdToUrl.delete(tileId);
    const tc = tileIdToCanvas.get(tileId);
    if (tc) { canvasToTileId.delete(tc); tileIdToCanvas.delete(tileId); }

    if (url) {
      releaseVideo(url);
    }
  });

  // Release the shared WebGL context when the layer is removed.
  layer.on('remove', () => {
    timingObject.off('timeupdate', layerTimingListener);
    stopLayerDraw();
    if (paintBatchRafId !== null) { cancelAnimationFrame(paintBatchRafId); paintBatchRafId = null; }
    if (sharedLGL) {
      const ext = sharedLGL.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      sharedLGL = null;
    }
    glInitialised = false;
    // Null the cached rgbs reference so the next paintFrame re-uploads the LUT
    // to the new GL context; otherwise the reference-equality check skips the
    // upload and the shader samples from a blank texture (renders black).
    layerLastRgbs = null;
    // Create a fresh canvas so the next addLayer gets a live GL context.
    // After loseContext(), canvas.getContext('webgl') returns the same dead
    // context object (per HTML spec), making all GL calls no-ops and
    // ctx2d.drawImage() copy a blank frame — tiles would stay transparent.
    sharedGLCanvas = document.createElement('canvas');
  });

  return layer;
}
