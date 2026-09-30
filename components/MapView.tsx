'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import { TimingObject } from '@/lib/TimingObject';
import { createVideoTileLayer } from '@/lib/VideoTileLayer';
import { buildColorLUT, brightnessToSSH, type ColormapName } from '@/lib/colormap';
import type { RgbColor } from '@/lib/colormap';
import { Paper, Button, Box, CircularProgress, Typography } from '@mui/material';
import styled from 'styled-components';
import PlaybackControls from './PlaybackControls';
import ColormapLegend from './ColormapLegend';
import SshReadout from './SshReadout';

const MapRoot = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  background: #0f1117;
`;

const MapContainer = styled.div`
  width: 100%;
  height: 100%;
`;

const ControlPanel = styled(Paper)`
  position: absolute !important;
  z-index: 1000;
  backdrop-filter: blur(8px) !important;
  background: rgba(255,255,255,0.93) !important;

  /* Mobile: bottom sheet */
  bottom: 0;
  left: 0;
  right: 0;
  border-radius: 16px 16px 0 0 !important;
  border-top: 1px solid rgba(0,0,0,0.08) !important;
  padding: 12px 16px 24px !important;
  box-shadow: 0 -4px 24px rgba(0,0,0,0.12) !important;

  @media (min-width: 640px) {
    bottom: auto;
    top: 16px;
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    border-radius: 20px !important;
    border: 1px solid rgba(255,255,255,0.6) !important;
    padding: 10px 20px 12px !important;
    box-shadow: 0 4px 24px rgba(0,0,0,0.12) !important;
    width: auto;
  }
`;

const LegendCorner = styled.div`
  position: absolute;
  top: 90px;
  right: 10px;
  z-index: 1000;
`;

const TitleCorner = styled.div`
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  pointer-events: none;
  white-space: nowrap;

  @media (min-width: 640px) {
    top: auto;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
  }
`;

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
    velocityMin:   0.1,   // velocity at speedMin
    velocityMax:   1.0,   // velocity at speedMax
    speedDefault:  0.5,
  },
  year: {
    src:           '/tiles/year',
    videoDuration: 2.5,
    startDate:     new Date(1993, 0, 1),
    endDate:       new Date(2018, 0, 1),
    timeUnit:      'year'   as const,
    label:         'Year',
    speedMin:      0.1,
    speedMax:      1.0,
    velocityMin:   1.0,   // 100% at slider=0.1
    velocityMax:   3.0,   // 300% at slider=1.0
    speedDefault:  0.55,  // slider value for 200% (velocity 2.0)
  },
} as const;

/** Maps a slider value (0.1–1.0) to the TimingObject velocity for a given layer. */
function computeVelocity(slider: number, layerKey: LayerKey): number {
  const { speedMin, speedMax, velocityMin, velocityMax } = LAYER_CONFIG[layerKey];
  const t = (slider - speedMin) / (speedMax - speedMin);
  return velocityMin + t * (velocityMax - velocityMin);
}

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
  const rgbsRef        = useRef<RgbColor[]>(buildColorLUT('Greys'));
  const speedRef       = useRef<number>(LAYER_CONFIG.year.speedDefault);
  const activeLayerRef = useRef<LayerKey>('year');
  const layersRef      = useRef<Record<LayerKey, L.GridLayer> | null>(null);
  const sshEnabledRef  = useRef(false);
  const scrubPlayRef   = useRef(false); // was playing before scrub started

  const [colormapName, setColormapName] = useState<ColormapName>('Greys');
  const [position,    setPosition]    = useState(0);
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [sshValue,    setSshValue]    = useState<string | null>(null);
  const [sshEnabled,  setSshEnabled]  = useState(false);
  const [activeLayer, setActiveLayer] = useState<LayerKey>('year');
  const [speed,       setSpeed]       = useState<number>(LAYER_CONFIG.year.speedDefault);
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
      maxZoom:       4.5,
      zoomSnap:      0.5,
      zoomDelta:     0.5,
      worldCopyJump: true,
    });
    mapRef.current = map;

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        minZoom: 1,
        maxZoom: 5,
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
    layers.year.addTo(map);

    (Object.keys(LAYER_CONFIG) as LayerKey[])
      .filter((k) => k !== 'year')
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
      const shouldResume = state.wasPlaying;
      state.wasPlaying = false;
      setIsBuffering(false);
      if (shouldResume) to.update({ velocity: computeVelocity(speedRef.current, activeLayerRef.current) });
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
        to.update({ velocity: computeVelocity(speedRef.current, activeLayerRef.current) });
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

      speedRef.current = LAYER_CONFIG[newKey].speedDefault;
      setSpeed(LAYER_CONFIG[newKey].speedDefault);

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
    to.on('ended', () => {
      const activeL = layers[activeLayerRef.current] as any;
      if (typeof activeL?.syncAllTiles === 'function') activeL.syncAllTiles();
      setTimeout(() => to.update({ velocity: computeVelocity(speedRef.current, activeLayerRef.current) }), 500);
    });
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
  const handlePlay  = useCallback(() => timingRef.current?.update({ velocity: computeVelocity(speedRef.current, activeLayerRef.current) }), []);
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
      if (velocity !== 0) timingRef.current.update({ velocity: computeVelocity(newSpeed, activeLayerRef.current) });
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
      timingRef.current.update({ velocity: computeVelocity(speedRef.current, activeLayerRef.current) });
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
    <MapRoot>
      <MapContainer ref={containerRef} id="map" />

      {/* Buffering overlay */}
      {isBuffering && (
        <Box
          sx={{
            position: 'absolute', inset: 0, zIndex: 999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Paper
            elevation={4}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.25,
              bgcolor: 'rgba(10,10,10,0.65)', backdropFilter: 'blur(6px)',
              color: 'white', px: 2.5, py: 1.25, borderRadius: 3,
            }}
          >
            <CircularProgress size={16} sx={{ color: 'white' }} />
            <Typography sx={{ fontSize: 13, fontWeight: 500 }}>Syncing…</Typography>
          </Paper>
        </Box>
      )}

      {/* Control panel */}
      <ControlPanel elevation={4}>
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
          sshNode={
            <Button
              onClick={handleSshToggle}
              title={sshEnabled ? 'Disable SSH value' : 'Enable SSH value'}
              variant={sshEnabled ? 'contained' : 'outlined'}
              size="small"
              sx={{
                textTransform: 'none',
                fontSize: 13,
                px: { xs: 1, sm: 1.5 },
                py: 0.5,
                borderColor: sshEnabled ? undefined : '#ddd',
                color: sshEnabled ? undefined : '#555',
                width: { xs: 'auto', sm: '100px' },
                minWidth: 0,
              }}
            >
              SSH value
            </Button>
          }
        />
      </ControlPanel>

      <LegendCorner>
        <ColormapLegend value={colormapName} onChange={setColormapName} />
      </LegendCorner>

      <TitleCorner>
        <Paper
          elevation={3}
          sx={{
            bgcolor: 'rgba(10,10,10,0.65)',
            backdropFilter: 'blur(6px)',
            color: 'white',
            px: 1.5,
            py: 0.75,
            borderRadius: 2.5,
          }}
        >
          <Typography sx={{ fontSize: 12, fontWeight: 500, lineHeight: 1.4 }}>
            Sea Surface Height (SSH) Anomaly · 1993–2018
          </Typography>
        </Paper>
      </TitleCorner>

      <SshReadout value={sshEnabled ? sshValue : null} />
    </MapRoot>
  );
}
