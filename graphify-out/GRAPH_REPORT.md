# Graph Report - nextjs-app  (2026-09-29)

## Corpus Check
- Corpus is ~14,546 words - fits in a single context window. You may not need a graph.

## Summary
- 181 nodes · 240 edges · 17 communities (12 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- App Shell & Config
- Test Suite & Mocks
- Page & Layer Setup
- TypeScript Config
- Build & Dev Deps
- Playback & Timing
- Colormap & Legend
- TimingObject Types
- WebGL Tile Pipeline
- Runtime Dependencies
- SSH Data & Overview
- NPM Scripts
- Next.js Config
- PostCSS Config
- TS Env Declaration
- ColormapLegend Ref
- SshReadout Ref

## God Nodes (most connected - your core abstractions)
1. `TimingObject` - 19 edges
2. `compilerOptions` - 15 edges
3. `MapView()` - 11 edges
4. `VideoTileLayer` - 7 edges
5. `MockLayer()` - 5 edges
6. `RgbColor` - 5 edges
7. `buildColorLUT()` - 5 edges
8. `scripts` - 5 edges
9. `react` - 5 edges
10. `createVideoTileLayer()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `makeTo()` --calls--> `TimingObject`  [EXTRACTED]
  __tests__/VideoTileLayer.test.ts → lib/TimingObject.ts
- `make()` --calls--> `TimingObject`  [EXTRACTED]
  __tests__/TimingObject.test.ts → lib/TimingObject.ts
- `MapView()` --calls--> `brightnessToSSH()`  [EXTRACTED]
  components/MapView.tsx → lib/colormap.ts
- `MapView()` --calls--> `buildColorLUT()`  [EXTRACTED]
  components/MapView.tsx → lib/colormap.ts
- `MapView()` --calls--> `createVideoTileLayer()`  [EXTRACTED]
  components/MapView.tsx → lib/VideoTileLayer.ts

## Import Cycles
- None detected.

## Communities (17 total, 5 thin omitted)

### Community 0 - "App Shell & Config"
Cohesion: 0.07
Nodes (22): metadata, config, name, private, version, autoprefixer, jest, jest-environment-jsdom (+14 more)

### Community 1 - "Test Suite & Mocks"
Cohesion: 0.11
Nodes (9): mockCtx2d, mockGl, @testing-library/jest-dom, capturedProto, fireTileUnload(), makeTo(), MockLayer(), RGBS (+1 more)

### Community 2 - "Page & Layer Setup"
Cohesion: 0.16
Nodes (11): MapView, formatDateLabel(), LAYER_CONFIG, LayerKey, PlaybackControls(), PlaybackControlsProps, SshReadout(), SshReadoutProps (+3 more)

### Community 3 - "TypeScript Config"
Cohesion: 0.11
Nodes (17): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+9 more)

### Community 4 - "Build & Dev Deps"
Cohesion: 0.12
Nodes (17): devDependencies, autoprefixer, jest, jest-environment-jsdom, postcss, tailwindcss, @testing-library/jest-dom, @testing-library/react (+9 more)

### Community 5 - "Playback & Timing"
Cohesion: 0.28
Nodes (4): MapView(), TimingObject, make(), RANGE

### Community 6 - "Colormap & Legend"
Cohesion: 0.22
Nodes (11): D3, ColormapLegend(), COLORMAPS, Props, brightnessToSSH(), buildColorLUT(), COLORMAP_PREVIEWS, ColormapName (+3 more)

### Community 7 - "TimingObject Types"
Cohesion: 0.15
Nodes (10): RgbColor, TimingCallback, TimingEvent, TimingState, TimingUpdateOptions, createVideoTileLayer(), DATA_ZOOM_FOR_TILE_Z, LayerGL (+2 more)

### Community 8 - "WebGL Tile Pipeline"
Cohesion: 0.20
Nodes (11): GL upload deduplication, 256x1 LUT texture, Leaflet, MapView, PlaybackControls, requestVideoFrameCallback, Seek-driven sync (100ms loop), TimingObject (+3 more)

### Community 9 - "Runtime Dependencies"
Cohesion: 0.33
Nodes (6): dependencies, d3, leaflet, next, react, react-dom

### Community 10 - "SSH Data & Overview"
Cohesion: 0.40
Nodes (5): CMEMS / Copernicus Marine, Monthly layer (300 frames), Next.js 14 (App Router), SSH Ocean Visualization, Yearly layer (25 frames)

### Community 11 - "NPM Scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, start

## Knowledge Gaps
- **89 isolated node(s):** `RANGE`, `capturedProto`, `RGBS`, `tileCtx`, `defaultProps` (+84 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 107 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `Build & Dev Deps` to `App Shell & Config`?**
  _High betweenness centrality (0.138) - this node is a cross-community bridge._
- **Why does `leaflet` connect `TimingObject Types` to `App Shell & Config`, `Page & Layer Setup`?**
  _High betweenness centrality (0.111) - this node is a cross-community bridge._
- **Why does `TimingObject` connect `Playback & Timing` to `Test Suite & Mocks`, `Page & Layer Setup`, `TimingObject Types`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `MapView()` (e.g. with `.destroy()` and `.on()`) actually correct?**
  _`MapView()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `RANGE`, `capturedProto`, `RGBS` to the rest of the system?**
  _89 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App Shell & Config` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `Test Suite & Mocks` be split into smaller, more focused modules?**
  _Cohesion score 0.10952380952380952 - nodes in this community are weakly interconnected._