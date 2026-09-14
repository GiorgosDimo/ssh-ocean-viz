/**
 * colormap.ts
 *
 * Builds a 256-entry RGB lookup table (LUT) from a D3 sequential color scale.
 * The SSH videos are greyscale — each pixel's red-channel value (0–255) is an
 * encoded sea-surface height.  The LUT maps that luminance to a display colour.
 *
 * The domain [200, 50] intentionally *reverses* the gradient so that:
 *   index 0   → "high" end of the colormap (warm colours in Spectral)
 *   index 255 → "low"  end of the colormap (cool colours in Spectral)
 *
 * This matches the original thesis encoding where brighter pixels = higher SSH.
 */

import * as d3 from 'd3';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export type ColormapName =
  | 'Spectral' | 'RdBu'   | 'Viridis' | 'Plasma'
  | 'Inferno'  | 'Turbo'  | 'RdYlBu'  | 'BrBG'
  | 'PiYG'     | 'PRGn'   | 'Greys';

// SSH range shown on the colormap legend (metres).
export const SSH_MIN = -1.0;
export const SSH_MAX =  1.0;

/**
 * CSS gradient preview for each colormap, oriented so that the LEFT end
 * represents low SSH (dim video pixels, t→1 in the reversed domain) and
 * the RIGHT end represents high SSH (bright pixels, t→0).
 */
export const COLORMAP_PREVIEWS: Record<ColormapName, string> = {
  Spectral: 'linear-gradient(to right,#3288bd,#66c2a5,#ffffbf,#f46d43,#d53e4f)',
  RdBu:     'linear-gradient(to right,#4575b4,#abd9e9,#f7f7f7,#f4a582,#d73027)',
  Viridis:  'linear-gradient(to right,#fde725,#5ec962,#21918c,#3b528b,#440154)',
  Plasma:   'linear-gradient(to right,#f0f921,#f89540,#cc4778,#7201a8,#0d0887)',
  Inferno:  'linear-gradient(to right,#fcffa4,#f98c0a,#bc3754,#57106e,#000004)',
  Turbo:    'linear-gradient(to right,#7a0403,#f77f00,#c5e642,#22c1b0,#30123b)',
  RdYlBu:   'linear-gradient(to right,#313695,#74add1,#ffffbf,#f46d43,#a50026)',
  BrBG:     'linear-gradient(to right,#003c30,#35978f,#f5f5f5,#bf812d,#543005)',
  PiYG:     'linear-gradient(to right,#276419,#b8e186,#f7f7f7,#f1b6da,#8e0152)',
  PRGn:     'linear-gradient(to right,#00441b,#5aae61,#f7f7f7,#9970ab,#40004b)',
  Greys:    'linear-gradient(to right,#000000,#ffffff)',
};

/**
 * Build the full 256-entry LUT for the given D3 colormap.
 * Domain [200, 50] is intentionally reversed so that brighter video pixels
 * (higher SSH) map to the "hot" start of each scale.
 */
export function buildColorLUT(name: ColormapName): RgbColor[] {
  const interpolator = d3[`interpolate${name}` as keyof typeof d3] as (t: number) => string;
  if (typeof interpolator !== 'function') {
    throw new Error(`Unknown D3 interpolator: interpolate${name}`);
  }
  const scale = d3.scaleSequential(interpolator).domain([200, 50]);
  return d3.range(256).map((i) => {
    const { r, g, b } = d3.rgb(scale(i));
    return { r: Math.round(r ?? 0), g: Math.round(g ?? 0), b: Math.round(b ?? 0) };
  });
}

/**
 * Convert raw video brightness (0–1) to SSH in metres.
 * Encoding: SSH = brightness * 2 − 1  →  range [−1, +1] m.
 */
export function brightnessToSSH(brightness: number): number {
  return Math.round((brightness * 2 - 1) * 100) / 100;
}
