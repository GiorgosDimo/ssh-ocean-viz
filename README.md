# SSH Ocean Visualization

Interactive visualization of **Sea Surface Height (SSH)** anomalies across the global ocean (1993–2018), rendered as WebGL-accelerated video tiles on an interactive map.

Built as part of an MSc thesis in oceanography / geospatial data science.

**[Live Demo →](https://ssh-ocean-hrafj4xu6-georgosdimopoulos-2195.vercel.app/)**

![SSH Visualization](https://raw.githubusercontent.com/GiorgosDimo/ssh-ocean-viz/main/docs/preview.gif)

---

## What it shows

Satellite altimetry data from 1993 to 2018, encoded as greyscale video tiles and re-coloured in real time. Bright pixels = high SSH, dark pixels = low SSH. Two temporal resolutions:

| Layer | Frames | Period | Speed range |
|-------|--------|--------|-------------|
| Monthly | 300 frames @ 25 fps | Jan 1993 – Jan 2018 | 10 % – 100 % |
| Yearly  | 25 frames @ 25 fps  | Jan 1993 – Jan 2018 | 100 % – 200 % |

---

## Technical highlights

### WebGL colormap rendering
Each tile is a greyscale `.mp4`. A 256×1 LUT texture (built from D3 sequential scales) is uploaded once per colormap change. The fragment shader samples both textures per pixel — no CPU pixel loop, no canvas `getImageData`.

```glsl
float b = texture2D(u_video, v_uv).r;
gl_FragColor = vec4(texture2D(u_lut, vec2(b, 0.5)).rgb, 1.0);
```

### Seek-driven sync
Videos are always paused. A 100 ms drift-correction loop seeks any video whose `currentTime` deviates by more than one frame (40 ms) from the timing object's position. This replaces rate-control (which causes inter-tile seam artifacts) with explicit frame targeting.

### requestVideoFrameCallback
On Chromium browsers the seek loop runs via `setTimeout` at 10 Hz; painting is handled by `requestVideoFrameCallback` callbacks that fire exactly when the browser has a decoded frame ready — no polling, no stale frames.

### GL upload deduplication
The shared WebGL canvas tracks `(url, time, lutVersion)`. `texImage2D + drawArrays` are skipped if the canvas already holds the correct frame; only the cheap `ctx2d.drawImage` blit to the tile canvas runs. Tiles sharing the same video URL benefit most at high zoom.

### Video pool
One `<video>` element per unique URL, reference-counted. On release: `removeAttribute('src')` + `load()` forces the browser to drop decoder buffers and network connections — preventing the progressive CPU/RAM growth seen with unreleased media elements.

---

## Stack

- **Next.js 14** (App Router, TypeScript)
- **Leaflet** — interactive map, tile grid
- **WebGL** — per-tile GPU colormap lookup
- **D3** — 11 sequential colormaps (`Spectral`, `Viridis`, `Plasma`, `Inferno`, `Turbo`, `RdBu`, `RdYlBu`, `BrBG`, `PiYG`, `PRGn`, `Greys`)
- **Tailwind CSS** — UI controls
- **Jest + Testing Library** — 88 unit tests

---

## Features

- ▶ Play / pause / reset with timeline scrubber
- 🎨 11 colormaps — click the legend to switch
- 🌊 SSH hover readout (raw brightness → metres, bypasses colormap distortion)
- 🔍 Zoom levels 1–3, dark ocean background
- ⚡ Layer switch (monthly ↔ yearly) with per-layer speed ranges

---

## Getting started

```bash
cp .env.example .env.local   # add your Mapbox token
npm install
npm run dev
```

Tiles are pre-built and committed under `public/tiles/` (29 MB). No external data fetch required.

```
public/tiles/
  month/{z}/{x}/{y}.mp4   # 300-frame monthly SSH videos
  year/{z}/{x}/{y}.mp4    # 25-frame yearly SSH videos
```

### Deploy to Vercel

1. Import the repo at [vercel.com/new](https://vercel.com/new)
2. Add `NEXT_PUBLIC_MAPBOX_TOKEN` in **Project Settings → Environment Variables**
3. Deploy — Next.js serves `public/` statically, no CDN config needed

---

## Architecture

```
lib/
  VideoTileLayer.ts   — Leaflet GridLayer + WebGL renderer + video pool
  TimingObject.ts     — playback clock (position + velocity)
  colormap.ts         — D3 LUT builder, SSH conversion
components/
  MapView.tsx         — map init, layer switching, SSH readout
  PlaybackControls.tsx — scrubber, speed slider
  ColormapLegend.tsx  — colormap picker
  SshReadout.tsx      — hover SSH value pill
```

---

## Data

SSH anomaly data derived from satellite altimetry (CMEMS / Copernicus Marine Service). Encoded as 512×512 greyscale video tiles using FFmpeg. Pixel value → SSH: `SSH = brightness × 2 − 1` (metres, range −1 to +1 m).
