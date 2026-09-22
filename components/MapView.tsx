'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import { TimingObject } from '@/lib/TimingObject';
import { createVideoTileLayer } from '@/lib/VideoTileLayer';
import { buildColorLUT, brightnessToSSH, type ColormapName } from '@/lib/colormap';
import type { RgbColor } from '@/lib/colormap';
import PlaybackControls from './PlaybackControls';
import ColormapLegend from './ColormapLegend';
import SshReadout from './SshReadout';

// ─── Layer configuration ──────────────────────────────────────────────────────

const ANIMATION_DURATION = 30;

const LAYER_CONFIG = {
  month: {
    src:           '/tiles/month',
    videoDuration: 30,
    startDate:     new Date(1993, 0, 1),
    endDate:       new Date(2018, 0, 1),
    timeUnit:      'month'  as const,
    label:         'Month',
    speedMin:      0.1,
    speedMax:      1.0,
  },
  year: {
    src:           '/tiles/year',
    videoDuration: 2.5,
    startDate:     new Date(1993, 0, 1),
    endDate:       new Date(2018, 0, 1),
    timeUnit:      'year'   as const,
    label:         'Year',
    speedMin:      1.0,
    speedMax:      2.0,
  },
} as const;

type LayerKey = keyof typeof LAYER_CONFIG;

// ─── Date helpers ─────────────────────────────────────────────────────────────

function formatDateLabel(position: number, layerKey: LayerKey): string {
  const cfg = LAYER_CONFIG[layerKey];
  const t   = Math.min(1, position / ANIMATION_DURATION);
  const ms  = cfg.startDate.getTime() + t * (cfg.endDate.getTime() - cfg.startDate.getTime());
  const date = new Date(ms);
  if (cfg.timeUnit === 'month') {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  }
  return String(date.getFullYear());
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MapView() {
  const containerRef   = useRef<HTMLDivElement>(null);
  const mapRef         = useRef<L.Map | null>(null);
  const timingRef      = useRef<TimingObject | null>(null);
  const rgbsRef        = useRef<RgbColor[]>(buildColorLUT('Viridis'));
  const speedRef       = useRef<number>(1.0);
  const activeLayerRef = useRef<LayerKey>('month');
  const layersRef      = useRef<Record<LayerKey, L.GridLayer> | null>(null);
  const sshEnabledRef  = useRef(false);
  const scrubPlayRef   = useRef(false); // was playing before scrub started

  const [colormapName, setColormapName] = useState<ColormapName>('Viridis');
  const [position,    setPosition]    = useState(0);
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [sshValue,    setSshValue]    = useState<string | null>(null);
  const [sshEnabled,  setSshEnabled]  = useState(false);
  const [activeLayer, setActiveLayer] = useState<LayerKey>('month');
  const [speed,       setSpeed]       = useState(1.0);
  const [isBuffering, setIsBuffering] = useState(false);

  // Keep sshEnabledRef in sync so Leaflet event handlers see the current value.
  useEffect(() => { sshEnabledRef.current = sshEnabled; }, [sshEnabled]);

  useEffect(() => {
    rgbsRef.current = buildColorLUT(colormapName);
    if (layersRef.current) {
      Object.values(layersRef.current).forEach((l) => {
        if (typeof (l as any).repaintAllTiles === 'function') (l as any).repaintAllTiles();
      });
    }
  }, [colormapName]);

  // ─── Map init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new L.Map(containerRef.current, {
      center:        new L.LatLng(0, 0),
      zoom:          2,
      minZoom:       1,
      maxZoom:       3,
      worldCopyJump: true,
    });
    mapRef.current = map;

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        minZoom: 1,
        maxZoom: 3,
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, ' +
          'Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      },
    ).addTo(map);

    const to = new TimingObject({ range: [0, ANIMATION_DURATION] });
    timingRef.current = to;

    const getRgbs = () => rgbsRef.current;

    const layers = Object.fromEntries(
      (Object.entries(LAYER_CONFIG) as [LayerKey, typeof LAYER_CONFIG[LayerKey]][]).map(
        ([key, cfg]) => [
          key,
          createVideoTileLayer({
            src:          cfg.src,
            timingObject: to,
            getRgbs,
            speedRatio:   cfg.videoDuration / ANIMATION_DURATION,
          }),
        ],
      ),
    ) as Record<LayerKey, L.GridLayer>;

    layersRef.current = layers;

    const baseLayers = Object.fromEntries(
      (Object.keys(LAYER_CONFIG) as LayerKey[]).map((key) => [
        LAYER_CONFIG[key].label,
        layers[key],
      ]),
    );
    L.control.layers(baseLayers).addTo(map);
    layers.month.addTo(map);

    (Object.keys(LAYER_CONFIG) as LayerKey[])
      .filter((k) => k !== 'month')
      .forEach((k) => (layers[k] as any).setSuspended(true));

    // ── Zoom / pan buffering ───────────────────────────────────────────────
    const state = { wasPlaying: false };
    let layerSwitchTimer: ReturnType<typeof setTimeout> | null = null;
    let panZoomTimer:     ReturnType<typeof setTimeout> | null = null;
    let resyncInterval:   ReturnType<typeof setInterval> | null = null;

    const startBuffering = () => {
      if (state.wasPlaying) return;
      const { velocity } = to.query();
      if (velocity !== 0) {
        state.wasPlaying = true;
        to.update({ velocity: 0 });
        setIsBuffering(true);
      }
    };

    const finishBuffering = () => {
      if (!state.wasPlaying) return;
      state.wasPlaying = false;
      setIsBuffering(false);
      to.update({ velocity: speedRef.current });
    };

    const scheduleBufferedResume = () => {
      const activeL = layers[activeLayerRef.current] as any;
      if (typeof activeL.syncAllTiles === 'function') activeL.syncAllTiles();
      if (panZoomTimer) clearTimeout(panZoomTimer);
      panZoomTimer = setTimeout(() => { panZoomTimer = null; finishBuffering(); }, 500);
    };

    map.on('movestart', startBuffering);
    map.on('zoomstart', startBuffering);
    map.on('moveend',   scheduleBufferedResume);
    map.on('zoomend',   scheduleBufferedResume);

    let firstLoad = true;
    const onTilesReady = () => {
      if (layerSwitchTimer) { clearTimeout(layerSwitchTimer); layerSwitchTimer = null; }
      finishBuffering();
      if (firstLoad) {
        firstLoad = false;
        to.update({ velocity: speedRef.current });
      }
      const activeL = layers[activeLayerRef.current] as any;
      if (typeof activeL.kickLayerDraw === 'function') activeL.kickLayerDraw();
    };
    Object.values(layers).forEach((l) => l.on('tilesready', onTilesReady));

    // ── Layer switch ───────────────────────────────────────────────────────
    map.on('baselayerchange', (e: L.LayersControlEvent) => {
      const oldKey = activeLayerRef.current;
      const newKey = (Object.keys(LAYER_CONFIG) as LayerKey[]).find(
        (k) => LAYER_CONFIG[k].label === e.name,
      );
      if (!newKey || newKey === oldKey) return;

      const { velocity } = to.query();
      state.wasPlaying = state.wasPlaying || velocity !== 0;
      to.update({ velocity: 0 });
      to.update({ position: 0 });

      // Reset speed to 100% for the new layer.
      speedRef.current = 1.0;
      setSpeed(1.0);

      setActiveLayer(newKey);
      activeLayerRef.current = newKey;

      setIsBuffering(true);
      if (layerSwitchTimer) clearTimeout(layerSwitchTimer);
      layerSwitchTimer = setTimeout(() => { layerSwitchTimer = null; finishBuffering(); }, 2000);

      (layers[oldKey] as any).setSuspended(true);
      (layers[newKey] as any).setSuspended(false);
    });

    // ── SSH readout (hover) ────────────────────────────────────────────────
    const onLayerMouseMove = (evt: L.LeafletMouseEvent) => {
      if (!sshEnabledRef.current) return;
      const canvas = evt.originalEvent.target as HTMLCanvasElement;
      const activeL = layers[activeLayerRef.current] as any;
      if (typeof activeL.samplePixel !== 'function') return;
      const { offsetX: x, offsetY: y } = evt.originalEvent;
      const brightness = activeL.samplePixel(canvas, x, y);
      if (brightness === null) {
        setSshValue(null);
        return;
      }
      const ssh = brightnessToSSH(brightness);
      setSshValue(`${ssh >= 0 ? '+' : ''}${ssh.toFixed(2)} m`);
    };

    const onLayerMouseOut = () => { setSshValue(null); };

    Object.values(layers).forEach((l) => {
      l.on('mousemove', onLayerMouseMove);
      l.on('mouseout',  onLayerMouseOut);
    });

    to.startUpdateLoop(100);
    to.on('timeupdate', () => {
      const { position: pos, velocity } = to.query();
      setPosition(pos);
      setIsPlaying(velocity !== 0);
      if (velocity !== 0 && !resyncInterval) {
        resyncInterval = setInterval(() => {
          const activeL = layers[activeLayerRef.current] as any;
          if (typeof activeL.syncAllTiles === 'function') activeL.syncAllTiles();
        }, 500);
      } else if (velocity === 0 && resyncInterval) {
        clearInterval(resyncInterval);
        resyncInterval = null;
      }
    });

    return () => {
      if (layerSwitchTimer) clearTimeout(layerSwitchTimer);
      if (panZoomTimer)     clearTimeout(panZoomTimer);
      if (resyncInterval)   { clearInterval(resyncInterval); resyncInterval = null; }
      Object.values(layers).forEach((l) => l.off('tilesready', onTilesReady));
      to.destroy();
      map.remove();
      mapRef.current    = null;
      timingRef.current = null;
      layersRef.current = null;
    };
  }, []);

  // ─── Playback callbacks ─────────────────────────────────────────────────
  const handlePlay  = useCallback(() => timingRef.current?.update({ velocity: speedRef.current }), []);
  const handlePause = useCallback(() => timingRef.current?.update({ velocity: 0 }), []);
  const handleReset = useCallback(() => {
    timingRef.current?.update({ velocity: 0 });
    timingRef.current?.update({ position: 0 });
  }, []);

  const handleSpeedChange = useCallback((newSpeed: number) => {
    speedRef.current = newSpeed;
    setSpeed(newSpeed);
    if (timingRef.current) {
      const { velocity } = timingRef.current.query();
      if (velocity !== 0) timingRef.current.update({ velocity: newSpeed });
    }
  }, []);

  // ─── Scrubber callbacks ─────────────────────────────────────────────────
  const handleScrubStart = useCallback(() => {
    if (!timingRef.current) return;
    const { velocity } = timingRef.current.query();
    scrubPlayRef.current = velocity !== 0;
    timingRef.current.update({ velocity: 0 });
  }, []);

  const handleScrub = useCallback((pos: number) => {
    if (!timingRef.current) return;
    timingRef.current.update({ position: pos });
    const activeL = layersRef.current?.[activeLayerRef.current] as any;
    if (typeof activeL?.forceSyncAllTiles === 'function') activeL.forceSyncAllTiles();
  }, []);

  const handleScrubEnd = useCallback(() => {
    if (scrubPlayRef.current && timingRef.current) {
      scrubPlayRef.current = false;
      timingRef.current.update({ velocity: speedRef.current });
    }
  }, []);

  // ─── SSH toggle ─────────────────────────────────────────────────────────
  const handleSshToggle = useCallback(() => {
    setSshEnabled((prev) => {
      if (prev) setSshValue(null); // clear readout when disabling
      return !prev;
    });
  }, []);

  const cfg = LAYER_CONFIG[activeLayer];

  return (
    <div className="relative w-full h-full bg-[#0f1117]">
      <div ref={containerRef} id="map" className="w-full h-full" />

      {/* Buffering overlay */}
      {isBuffering && (
        <div className="absolute inset-0 z-[999] flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 text-white text-sm px-4 py-2 rounded-xl flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Syncing…
          </div>
        </div>
      )}

      {/* Control panel
            Mobile  : full-width bottom sheet, stacked layout
            sm+     : top-centre pill, horizontal layout (original)       */}
      <div className={[
        'absolute z-[1000]',
        'bg-white/95 backdrop-blur-sm',
        // mobile
        'bottom-0 left-0 right-0 flex flex-col gap-3',
        'px-4 pt-3 pb-6 rounded-t-2xl border-t border-gray-200',
        'shadow-[0_-4px_16px_rgba(0,0,0,0.12)]',
        // sm+
        'sm:bottom-auto sm:top-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2',
        'sm:flex-row sm:items-center sm:gap-3',
        'sm:px-5 sm:py-2.5 sm:rounded-2xl sm:border sm:border-white/60 sm:shadow-lg sm:bg-white/90',
      ].join(' ')}>
        <PlaybackControls
          isPlaying={isPlaying}
          position={position}
          maxPosition={ANIMATION_DURATION}
          dateLabel={formatDateLabel(position, activeLayer)}
          startDateLabel={formatDateLabel(0, activeLayer)}
          endDateLabel={formatDateLabel(ANIMATION_DURATION, activeLayer)}
          speed={speed}
          speedMin={cfg.speedMin}
          speedMax={cfg.speedMax}
          onPlay={handlePlay}
          onPause={handlePause}
          onReset={handleReset}
          onSpeedChange={handleSpeedChange}
          onScrubStart={handleScrubStart}
          onScrub={handleScrub}
          onScrubEnd={handleScrubEnd}
        />

        {/* Divider — desktop only */}
        <div className="hidden sm:block w-px h-8 bg-gray-200" />

        {/* SSH toggle */}
        <button
          onClick={handleSshToggle}
          title={sshEnabled ? 'Disable SSH readout' : 'Enable SSH readout'}
          className={`self-start sm:self-auto px-3 py-1.5 sm:py-1 rounded-lg text-sm font-medium transition-all active:scale-95 ${
            sshEnabled
              ? 'bg-blue-500 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          SSH readout
        </button>
      </div>

      {/* Colormap legend
            Mobile : sits above the bottom sheet (~160 px clearance)
            sm+    : original bottom-right position                       */}
      <div className="absolute bottom-[168px] right-2 sm:bottom-6 sm:right-4 z-[1000]">
        <ColormapLegend value={colormapName} onChange={setColormapName} />
      </div>

      {/* Title */}
      <div className="absolute bottom-[168px] left-2 sm:bottom-6 sm:left-4 z-[1000] pointer-events-none">
        <div className="bg-black/60 backdrop-blur-sm text-white px-3 py-1.5 rounded-xl text-xs font-medium leading-snug max-w-[200px] sm:max-w-none">
          Sea Surface Height (SSH) Anomaly<br className="sm:hidden" /><span className="hidden sm:inline"> · </span>1993–2018
        </div>
      </div>

      {/* SSH hover readout — centred, clear of the bottom sheet on mobile */}
      <SshReadout value={sshEnabled ? sshValue : null} />
    </div>
  );
}
