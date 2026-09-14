import { buildColorLUT, brightnessToSSH } from '@/lib/colormap';

describe('buildColorLUT', () => {
  it('returns exactly 256 entries', () => {
    expect(buildColorLUT('Spectral')).toHaveLength(256);
    expect(buildColorLUT('RdBu')).toHaveLength(256);
  });

  it('each entry has integer r/g/b in [0, 255]', () => {
    buildColorLUT('Spectral').forEach(({ r, g, b }) => {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
      expect(Number.isInteger(r)).toBe(true);
      expect(Number.isInteger(g)).toBe(true);
      expect(Number.isInteger(b)).toBe(true);
    });
  });

  it('produces different tables for each colormap', () => {
    const spectral = buildColorLUT('Spectral');
    const rdbu     = buildColorLUT('RdBu');
    // They should differ somewhere across 256 entries
    const differs = spectral.some((c, i) =>
      c.r !== rdbu[i].r || c.g !== rdbu[i].g || c.b !== rdbu[i].b,
    );
    expect(differs).toBe(true);
  });

  it('throws on unknown colormap name', () => {
    expect(() => buildColorLUT('Unknown' as any)).toThrow();
  });
});

describe('brightnessToSSH', () => {
  // brightnessToSSH now takes a raw 0–1 brightness value (the video red channel
  // divided by 255) so SSH readout correctly inverts the raw pixel value rather
  // than the colormap-distorted canvas RGB.

  it('maps mid brightness (0.5) to ≈ 0 m', () => {
    expect(Math.abs(brightnessToSSH(0.5))).toBeLessThan(0.1);
  });

  it('maps brightness 0 to −1 m', () => {
    expect(brightnessToSSH(0)).toBe(-1);
  });

  it('maps brightness 1 to +1 m', () => {
    expect(brightnessToSSH(1)).toBe(1);
  });

  it('returns a value rounded to 2 decimal places', () => {
    const ssh = brightnessToSSH(100 / 255);
    const rounded = Math.round(ssh * 100) / 100;
    expect(ssh).toBe(rounded);
  });

  it('applies SSH = brightness * 2 − 1 formula', () => {
    const b        = 60 / 255;
    const expected = Math.round((b * 2 - 1) * 100) / 100;
    expect(brightnessToSSH(b)).toBe(expected);
  });
});
