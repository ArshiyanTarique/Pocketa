import { describe, it, expect } from 'vitest';
import { translate, trf } from './i18n';
import { UR_SCREENS } from './i18n.ur';
import { useStore } from '../store/useStore';

// Every source file in the app, as text, so the keys can be read off the screens.
const SOURCES = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Every string literal passed to tr(), trf() or t() anywhere in the app. */
function keysUsedInApp(): string[] {
  const out = new Set<string>();
  const pattern = /\b(?:tr|trf|t)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  for (const [path, src] of Object.entries(SOURCES)) {
    if (/\.test\./.test(path) || /i18n/.test(path)) continue;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(src))) out.add(m[2].replace(/\\'/g, "'"));
  }
  return [...out].sort();
}

describe('the Urdu dictionary', () => {
  const keys = keysUsedInApp();

  it('reads the keys off the real screens', () => {
    expect(keys.length).toBeGreaterThan(300);
    expect(keys).toContain('Add a budget');
  });

  it('covers every string the screens ask for', () => {
    const missing = keys.filter((k) => translate(k, 'ur') === k);
    expect(missing, `no Urdu for:\n${missing.join('\n')}`).toEqual([]);
  });

  it('keeps every placeholder so the numbers and names still land', () => {
    const broken: string[] = [];
    for (const key of keys) {
      const slots = key.match(/\{\w+\}/g) ?? [];
      const ur = translate(key, 'ur');
      for (const slot of slots) if (!ur.includes(slot)) broken.push(`${key} → ${ur}`);
    }
    expect(broken).toEqual([]);
  });

  it('has no empty translations', () => {
    const empty = Object.entries(UR_SCREENS).filter(([, v]) => !v.trim()).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('fills placeholders in whichever language is active', () => {
    expect(trf('{n} days left', { n: 3 })).toBe('3 days left');
    useStore.setState({ settings: { ...useStore.getState().settings, language: 'ur' } });
    expect(trf('{n} days left', { n: 3 })).toContain('3');
    useStore.setState({ settings: { ...useStore.getState().settings, language: 'en' } });
  });
});
