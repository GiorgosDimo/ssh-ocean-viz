'use client';

import { Paper, Typography, Box } from '@mui/material';

interface SshReadoutProps {
  value: string | null;
}

export default function SshReadout({ value }: SshReadoutProps) {
  if (!value) return null;
  return (
    <Box sx={{
      position: 'absolute',
      bottom: 220,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1000,
      pointerEvents: 'none',
      '@media (min-width: 640px)': { bottom: 80 },
    }}>
      <Paper
        elevation={6}
        sx={{
          display: 'flex', alignItems: 'baseline', gap: 0.75,
          bgcolor: 'rgba(10,10,10,0.75)', backdropFilter: 'blur(6px)',
          borderRadius: 3, px: 2, py: 1,
        }}
      >
        <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>SSH</Typography>
        <Typography sx={{ fontSize: 18, color: 'white', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
      </Paper>
    </Box>
  );
}
