'use client';

import { ReactNode } from 'react';
import { Stack, Button, Slider, Typography, Box } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import styled from 'styled-components';

interface PlaybackControlsProps {
  isPlaying:      boolean;
  position:       number;
  maxPosition:    number;
  dateLabel:      string;
  startDateLabel: string;
  endDateLabel:   string;
  speed:          number;
  speedMin:       number;
  speedMax:       number;
  onPlay:         () => void;
  onPause:        () => void;
  onReset:        () => void;
  onSpeedChange:  (speed: number) => void;
  onScrubStart:   () => void;
  onScrub:        (position: number) => void;
  onScrubEnd:     () => void;
  sshNode?:       ReactNode;
}

const DateText = styled(Typography)`
  font-size: 11px !important;
  color: #888;
  font-variant-numeric: tabular-nums;
`;

const DateBold = styled(Typography)`
  font-size: 12px !important;
  font-weight: 700 !important;
  color: #222;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
`;

const SpeedBadge = styled(Typography)`
  font-size: 11px !important;
  font-weight: 600 !important;
  color: #555;
  min-width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
`;

const TimelineBox = styled(Box)`
  display: flex;
  flex-direction: column;
  overflow: visible;
  gap: 0;
`;

const ICON_BTN_SX = {
  minWidth: 0,
  px: { xs: 0.75, sm: 1.5 },
  py: 0.5,
  fontSize: 13,
  textTransform: 'none',
} as const;

export default function PlaybackControls({
  isPlaying,
  position,
  maxPosition,
  dateLabel,
  startDateLabel,
  endDateLabel,
  speed,
  speedMin,
  speedMax,
  onPlay,
  onPause,
  onReset,
  onSpeedChange,
  onScrubStart,
  onScrub,
  onScrubEnd,
  sshNode,
}: PlaybackControlsProps) {
  const pct = maxPosition > 0 ? (position / maxPosition) * 100 : 0;

  return (
    <Stack sx={{
      flexDirection: 'row',
      flexWrap: { xs: 'wrap', sm: 'nowrap' },
      alignItems: 'center',
      gap: { xs: 0.75, sm: 1.5 },
    }}>

      {/* Transport — order 1 on both layouts; icon-only on mobile, icon+text on desktop */}
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        sx={{ order: 1, flexShrink: 0 }}
      >
        <Button
          size="small" variant="outlined" onClick={onReset} title="Reset to start"
          sx={{ ...ICON_BTN_SX, borderColor: '#ddd', color: '#444', '&:hover': { borderColor: '#bbb', bgcolor: '#f5f5f5' } }}
        >
          <SkipPreviousIcon fontSize="small" />
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' }, ml: 0.5 }}>Reset</Box>
        </Button>

        {isPlaying ? (
          <Button
            size="small" variant="contained" onClick={onPause} title="Pause"
            sx={{ ...ICON_BTN_SX, minWidth: 40, bgcolor: '#facc15', color: '#1a1a1a', boxShadow: 'none', '&:hover': { bgcolor: '#eab308', boxShadow: 'none' } }}
          >
            <PauseIcon fontSize="small" />
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' }, ml: 0.5 }}>Pause</Box>
          </Button>
        ) : (
          <Button
            size="small" variant="contained" onClick={onPlay} title="Play"
            color="success" sx={ICON_BTN_SX}
          >
            <PlayArrowIcon fontSize="small" />
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' }, minWidth: 40, ml: 0.5 }}>Play</Box>
          </Button>
        )}
      </Stack>

      {/* Timeline — Row 2 on mobile (full width), inline on desktop */}
      <TimelineBox sx={{ order: { xs: 3, sm: 2 }, width: { xs: '100%', sm: 'auto' }, minWidth: { sm: '260px' } }}>
        {/*
         * Label is inside this positioned Box so left:pct% is relative to the
         * same coordinate space as the MUI Slider thumb — exact horizontal alignment.
         */}
        <Box
          sx={{ position: 'relative', pt: '18px' }}
          onPointerDown={onScrubStart}
          onPointerUp={onScrubEnd}
        >
          <DateBold sx={{ position: 'absolute', top: 1, left: `${pct}%`, transform: 'translateX(-50%)' }}>
            {dateLabel}
          </DateBold>
          <Slider
            value={position}
            min={0}
            max={maxPosition}
            step={maxPosition / 1000}
            onChange={(_, v) => onScrub(v as number)}
            size="small"
            sx={{
              py: 0.5,
              color: '#3b82f6',
              '& .MuiSlider-thumb': {
                width: 3,
                height: 18,
                borderRadius: 1,
                '&::before': { boxShadow: 'none' },
                '&:hover, &.Mui-focusVisible': { boxShadow: 'none' },
              },
              '& .MuiSlider-track': { height: 3 },
              '& .MuiSlider-rail': { height: 3 },
            }}
          />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', px: 0.25 }}>
          <DateText>{startDateLabel}</DateText>
          <DateText>{endDateLabel}</DateText>
        </Box>
      </TimelineBox>

      {/* Speed — Row 1 on mobile (after transport), inline on desktop */}
      <Box sx={{
        order: { xs: 2, sm: 3 },
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <Typography sx={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap', display: { xs: 'none', sm: 'block' } }}>
          Speed
        </Typography>
        <Slider
          value={speed}
          min={speedMin}
          max={speedMax}
          step={(speedMax - speedMin) / 18}
          onChange={(_, v) => onSpeedChange(v as number)}
          size="small"
          sx={{ width: { xs: 60, sm: 80 }, color: '#3b82f6', '& .MuiSlider-thumb': { width: 12, height: 12 } }}
        />
        <SpeedBadge>{speed.toFixed(2)}</SpeedBadge>
      </Box>

      {/* SSH slot — Row 1 on mobile (same order as speed, after it in DOM), 4th on desktop */}
      {sshNode && (
        <Box sx={{ order: { xs: 2, sm: 4 }, flexShrink: 0 }}>
          {sshNode}
        </Box>
      )}
    </Stack>
  );
}
