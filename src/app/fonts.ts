/**
 * Font presets.
 *
 * Each preset is a pairing: a body face for reading and a display face for
 * headings and the big figures. Numbers keep the mono face regardless, so
 * columns stay aligned whatever the person picks. Faces load from Google
 * Fonts on demand — only the preset in use (and, on the Appearance tab, the
 * ones being previewed) ever reach the network.
 */

export type FontPreset = 'classic' | 'rounded' | 'playful' | 'modern' | 'editorial' | 'bold';

export interface FontPresetDef {
  id: FontPreset;
  label: string;
  /** One short line, shown under the name on the picker. */
  mood: string;
  sans: string;
  display: string;
  /** The `family=` parts of a Google Fonts css2 URL; empty when index.html already loads it. */
  google: string[];
}

const SANS_FALLBACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const FONT_PRESETS: FontPresetDef[] = [
  {
    id: 'classic',
    label: 'Classic',
    mood: 'Crisp and quiet',
    sans: `'Instrument Sans', ${SANS_FALLBACK}`,
    display: `'Bricolage Grotesque', 'Instrument Sans', ${SANS_FALLBACK}`,
    google: [],
  },
  {
    id: 'rounded',
    label: 'Rounded',
    mood: 'Soft and friendly',
    sans: `'Nunito', ${SANS_FALLBACK}`,
    display: `'Fredoka', 'Nunito', ${SANS_FALLBACK}`,
    google: ['Nunito:wght@400..800', 'Fredoka:wght@500..700'],
  },
  {
    id: 'playful',
    label: 'Playful',
    mood: 'Light with a bounce',
    sans: `'Quicksand', ${SANS_FALLBACK}`,
    display: `'Baloo 2', 'Quicksand', ${SANS_FALLBACK}`,
    google: ['Quicksand:wght@400..700', 'Baloo+2:wght@500..800'],
  },
  {
    id: 'modern',
    label: 'Modern',
    mood: 'Geometric and clean',
    sans: `'Outfit', ${SANS_FALLBACK}`,
    display: `'Space Grotesk', 'Outfit', ${SANS_FALLBACK}`,
    google: ['Outfit:wght@400..700', 'Space+Grotesk:wght@500..700'],
  },
  {
    id: 'editorial',
    label: 'Editorial',
    mood: 'Magazine headings',
    sans: `'Instrument Sans', ${SANS_FALLBACK}`,
    display: `'Fraunces', Georgia, 'Times New Roman', serif`,
    google: ['Fraunces:opsz,wght@9..144,500..800'],
  },
  {
    id: 'bold',
    label: 'Bold',
    mood: 'Loud and confident',
    sans: `'Sora', ${SANS_FALLBACK}`,
    display: `'Syne', 'Sora', ${SANS_FALLBACK}`,
    google: ['Sora:wght@400..700', 'Syne:wght@600..800'],
  },
];

export const DEFAULT_FONT: FontPreset = 'classic';

export function fontPreset(id: string | undefined | null): FontPresetDef {
  return FONT_PRESETS.find((p) => p.id === id) ?? FONT_PRESETS[0];
}

/** Adds the stylesheet for a preset once; a no-op for the default pairing. */
export function ensureFontLoaded(id: FontPreset): void {
  const preset = fontPreset(id);
  if (preset.google.length === 0 || typeof document === 'undefined') return;
  const key = `pocketa-font-${preset.id}`;
  if (document.getElementById(key)) return;
  const link = document.createElement('link');
  link.id = key;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${preset.google.map((f) => `family=${f}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

/** Points the two font variables at the preset; everything styled from them follows. */
export function applyFont(id: FontPreset): void {
  const preset = fontPreset(id);
  ensureFontLoaded(preset.id);
  const r = document.documentElement;
  if (preset.id === DEFAULT_FONT) {
    r.style.removeProperty('--font-sans');
    r.style.removeProperty('--font-display');
  } else {
    r.style.setProperty('--font-sans', preset.sans);
    r.style.setProperty('--font-display', preset.display);
  }
}
