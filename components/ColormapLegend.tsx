'use client';

import { useState } from 'react';
import { Box, Paper, Typography, ButtonBase } from '@mui/material';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import styled from 'styled-components';
import { COLORMAP_PREVIEWS, SSH_MIN, SSH_MAX, type ColormapName } from '@/lib/colormap';

const COLORMAPS: { name: ColormapName; label: string }[] = [
  { name: 'Spectral', label: 'Spectral'    },
  { name: 'RdBu',     label: 'Red–Blue'    },
  { name: 'RdYlBu',   label: 'Rd–Yl–Bl'   },
  { name: 'Viridis',  label: 'Viridis'     },
  { name: 'Plasma',   label: 'Plasma'      },
  { name: 'Turbo',    label: 'Turbo'       },
  { name: 'BrBG',     label: 'Br–Green'    },
  { name: 'PiYG',     label: 'Pink–Grn'    },
  { name: 'PRGn',     label: 'Purp–Grn'    },
  { name: 'Greys',    label: 'Black–White' },
];

interface Props {
  value:    ColormapName;
  onChange: (name: ColormapName) => void;
}

const GradientBar = styled.div<{ $gradient: string }>`
  width: 176px;
  height: 14px;
  border-radius: 4px;
  background: ${({ $gradient }) => $gradient};
`;

const ColormapRow = styled(ButtonBase)<{ $active: boolean }>`
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  padding: 6px 8px !important;
  border-radius: 8px !important;
  width: 100% !important;
  transition: background 0.15s !important;
  background: ${({ $active }) => ($active ? 'rgba(59,130,246,0.08)' : 'transparent')} !important;
  outline: ${({ $active }) => ($active ? '1px solid rgba(59,130,246,0.4)' : 'none')} !important;
  &:hover {
    background: rgba(0,0,0,0.04) !important;
  }
`;

export default function ColormapLegend({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Box sx={{ userSelect: 'none', position: 'relative' }}>
      {/* Dropdown — absolute, opens to the left of the trigger */}
      {open && (
        <Paper
          elevation={4}
          sx={{
            position: 'absolute',
            right: 'calc(100% + 8px)',
            top: 0,
            p: 1,
            borderRadius: 3,
            bgcolor: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(0,0,0,0.08)',
            minWidth: 208,
            zIndex: 1,
          }}
        >
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1, px: 1, mb: 0.5 }}>
            Colormap
          </Typography>
          {COLORMAPS.map((cm) => (
            <ColormapRow
              key={cm.name}
              $active={value === cm.name}
              onClick={() => { onChange(cm.name); setOpen(false); }}
            >
              <GradientBar $gradient={COLORMAP_PREVIEWS[cm.name]} />
              <Typography sx={{ fontSize: 12, color: '#444', fontWeight: 500 }}>{cm.label}</Typography>
            </ColormapRow>
          ))}
        </Paper>
      )}

      {/* Vertical legend trigger */}
      <Paper
        component={ButtonBase}
        onClick={() => setOpen((o) => !o)}
        title="Choose colormap"
        elevation={3}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0.5,
          bgcolor: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(8px)',
          borderRadius: 2,
          border: '1px solid rgba(0,0,0,0.08)',
          px: 0.75,
          py: 1,
          cursor: 'pointer',
          minWidth: 0,
          '&:hover': { bgcolor: 'white' },
        }}
      >
        <Typography sx={{ fontSize: 9, fontWeight: 700, color: '#777', textTransform: 'uppercase', letterSpacing: 0.8 }}>
          SSH
        </Typography>
        <Typography sx={{ fontSize: 9, color: '#999', fontVariantNumeric: 'tabular-nums' }}>
          {SSH_MAX.toFixed(0)}m
        </Typography>
        {/*
         * Vertical gradient: 14px wide × 100px tall container with the horizontal
         * gradient rotated 90° CW so SSH_MAX (light/right) sits at top.
         */}
        <Box sx={{ width: 14, height: 100, position: 'relative', overflow: 'hidden', borderRadius: '3px' }}>
          <Box sx={{
            position: 'absolute',
            width: 100,
            height: 14,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%) rotate(90deg)',
            background: COLORMAP_PREVIEWS[value],
          }} />
        </Box>
        <Typography sx={{ fontSize: 9, color: '#999', fontVariantNumeric: 'tabular-nums' }}>
          {SSH_MIN.toFixed(0)}m
        </Typography>
        {open
          ? <KeyboardArrowRightIcon sx={{ fontSize: 12, color: '#999' }} />
          : <KeyboardArrowLeftIcon sx={{ fontSize: 12, color: '#999' }} />
        }
      </Paper>
    </Box>
  );
}
