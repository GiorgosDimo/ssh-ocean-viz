'use client';

import { Paper, Typography, Box } from '@mui/material';
import styled from 'styled-components';

interface SshReadoutProps {
  value: string | null;
}

const ReadoutWrapper = styled.div`
  position: absolute;
  bottom: 220px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  pointer-events: none;

  @media (min-width: 640px) {
    bottom: 80px;
  }
`;

export default function SshReadout({ value }: SshReadoutProps) {
  if (!value) return null;
  return (
    <ReadoutWrapper>
      <Paper
        elevation={6}
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 0.75,
          bgcolor: 'rgba(10,10,10,0.75)',
          backdropFilter: 'blur(6px)',
          borderRadius: 3,
          px: 2,
          py: 1,
        }}
      >
        <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>SSH</Typography>
        <Typography sx={{ fontSize: 18, color: 'white', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
      </Paper>
    </ReadoutWrapper>
  );
}
