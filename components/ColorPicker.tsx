'use client';

import type { ColormapName } from '@/lib/colormap';

interface ColorPickerProps {
  value: ColormapName;
  onChange: (name: ColormapName) => void;
}

const COLORMAPS: { name: ColormapName; label: string; preview: string }[] = [
  {
    name: 'Spectral',
    label: 'Spectral',
    // CSS gradient that approximates the D3 Spectral scale (low → high)
    preview: 'linear-gradient(to right, #3288bd, #66c2a5, #abdda4, #e6f598, #fee08b, #fdae61, #f46d43, #d53e4f)',
  },
  {
    name: 'RdBu',
    label: 'RdBu',
    preview: 'linear-gradient(to right, #4575b4, #74add1, #abd9e9, #e0f3f8, #fee090, #fdae61, #f46d43, #d73027)',
  },
];

/**
 * Colormap switcher — mirrors the original RdBu / Spectral buttons but uses
 * a gradient swatch so the effect is visible before clicking.
 */
export default function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 font-medium">Colormap</span>
      {COLORMAPS.map((cm) => (
        <button
          key={cm.name}
          onClick={() => onChange(cm.name)}
          title={cm.name}
          className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg border-2 transition-all active:scale-95 ${
            value === cm.name
              ? 'border-blue-500 shadow-sm'
              : 'border-transparent hover:border-gray-300'
          }`}
        >
          <div
            className="w-20 h-3 rounded"
            style={{ background: cm.preview }}
          />
          <span className="text-[10px] text-gray-600">{cm.label}</span>
        </button>
      ))}
    </div>
  );
}
