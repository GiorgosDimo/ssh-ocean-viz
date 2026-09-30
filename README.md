# SSH Anomaly Visualiser

WebGIS app for exploring Sea Surface Height (SSH) anomalies across the global ocean from 1993 to 2018, built as an MSc thesis project.

## What it does

An animated Leaflet map renders greyscale SSH tiles as coloured video using a WebGL shader and a per-frame colour look-up table (LUT). Two temporal resolutions are available: monthly and yearly. The user can scrub, play/pause, change speed, pick a colormap, and hover to read SSH values in metres.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router, `ssr: false` for the map) |
| Map | Leaflet + custom `VideoTileLayer` |
| Rendering | WebGL (greyscale video → colormap via LUT texture) |
| Colormap maths | D3 sequential scales |
| UI | MUI v5 + Emotion |
| Timing | Custom `TimingObject` (seek-driven, not rate-driven) |
| Tests | Jest + Testing Library (77 tests) |

## Architecture

```
app/
  page.tsx          — dynamic import of MapView (no SSR)
  layout.tsx        — minimal HTML shell
  globals.css       — Leaflet CSS + tile layout + spinner keyframe

components/
  MapView.tsx       — map init, playback state, VideoTileLayer wiring
  PlaybackControls.tsx — transport buttons, timeline scrubber, speed slider
  ColormapLegend.tsx   — vertical gradient trigger + dropdown picker
  SshReadout.tsx       — floating SSH value overlay

lib/
  VideoTileLayer.ts — L.GridLayer factory; WebGL pipeline, video pool,
                      seek-driven sync, rVFC paint loop (799 lines)
  TimingObject.ts   — clock with velocity, range, ended/timeupdate events
  colormap.ts       — LUT builder (D3), ColormapName type, SSH ↔ brightness
```

### Key design decisions

- **Seek-driven playback** — all tiles are seeked to the same target `currentTime` on every `timeupdate` tick (100 ms). No rate-control; avoids inter-tile drift that shows as seam artifacts.
- **Video pool** — up to 12 `<video>` elements are shared across tiles with ref-counting. Each tile borrows a video, seeks it, blits to an off-screen canvas, then WebGL samples that canvas to apply the LUT.
- **WebGL LUT** — a single shared GL context paints all tiles. A 256×1 RGBA texture holds the active colormap; the fragment shader maps the red channel of the greyscale video pixel through it.
- **`requestVideoFrameCallback`** — used when available to schedule paint exactly on each decoded video frame instead of polling.

### Tile format

Tiles live in `public/tiles/{month,year}/{z}/{x}/{y}.mp4`. Each MP4 is a greyscale video (one channel used as SSH encoding). Brightness 0 = SSH −1 m, brightness 1 = SSH +1 m. The `scripts/fix-tile-mp4s.mjs` script re-muxes raw tiles to ensure browser-compatible MP4 headers.

### Layer config

Both layers span 1993–2018. `LAYER_CONFIG` in `MapView.tsx` controls tile source path, video duration, speed slider range, and the TimingObject velocity mapping.

## Running locally

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 77 tests
```

Tiles are not included in the repository. Place them under `public/tiles/` before running.
