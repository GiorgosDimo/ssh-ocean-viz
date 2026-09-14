'use client';

import { useState } from 'react';
import { COLORMAP_PREVIEWS, SSH_MIN, SSH_MAX, type ColormapName } from '@/lib/colormap';

const COLORMAPS: { name: ColormapName; label: string }[] = [
  { name: 'Spectral', label: 'Spectral'  },
  { name: 'RdBu',     label: 'Red–Blue'  },
  { name: 'RdYlBu',   label: 'Rd–Yl–Bl' },
  { name: 'Viridis',  label: 'Viridis'   },
  { name: 'Plasma',   label: 'Plasma'    },
  { name: 'Inferno',  label: 'Inferno'   },
  { name: 'Turbo',    label: 'Turbo'     },
  { name: 'BrBG',     label: 'Br–Green'  },
  { name: 'PiYG',     label: 'Pink–Grn'  },
  { name: 'PRGn',     label: 'Purp–Grn'  },
  { name: 'Greys',    label: 'Black–White'},
];

interface Props {
  value:    ColormapName;
  onChange: (name: ColormapName) => void;
}

export default function ColormapLegend({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const current = COLORMAPS.find((c) => c.name === value)!;

  return (
    <div className="absolute bottom-6 right-4 z-[1000] select-none">
      {/* ── Dropdown list (expands upward) ── */}
      {open && (
        <div className="mb-2 flex flex-col gap-1 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 p-2 w-52">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-1 mb-0.5">
            Colormap
          </p>
          {COLORMAPS.map((cm) => (
            <button
              key={cm.name}
              onClick={() => { onChange(cm.name); setOpen(false); }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all ${
                value === cm.name
                  ? 'bg-blue-50 ring-1 ring-blue-400'
                  : 'hover:bg-gray-50'
              }`}
            >
              <div
                className="w-24 h-3.5 rounded flex-shrink-0"
                style={{ background: COLORMAP_PREVIEWS[cm.name] }}
              />
              <span className="text-xs text-gray-700 font-medium">{cm.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Legend bar (always visible, click to open) ── */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Choose colormap"
        className="flex flex-col gap-1 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-200 px-3 py-2 hover:bg-white transition-all"
      >
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
            SSH · {current.label}
          </span>
          <span className="text-[10px] text-gray-400">{open ? '▼' : '▲'}</span>
        </div>

        {/* Gradient bar */}
        <div
          className="w-44 h-3.5 rounded"
          style={{ background: COLORMAP_PREVIEWS[value] }}
        />

        {/* Min / max labels */}
        <div className="flex justify-between text-[10px] text-gray-500 tabular-nums font-medium w-44">
          <span>{SSH_MIN.toFixed(1)} m</span>
          <span>{SSH_MAX.toFixed(1)} m</span>
        </div>
      </button>
    </div>
  );
}
